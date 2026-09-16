/**
 * Codex-format apply_patch parser.
 *
 * Faithful port of the grammar implemented by openai/codex's apply-patch
 * crate (codex-rs/apply-patch/src/parser.rs), so GPT-family models that were
 * trained on codex's tool emit patches this tool accepts verbatim:
 *
 *   start: begin_patch environment_id? hunk+ end_patch
 *   begin_patch: "*** Begin Patch" LF
 *   environment_id: "*** Environment ID: " filename LF
 *   end_patch: "*** End Patch" LF?
 *   hunk: add_hunk | delete_hunk | update_hunk
 *   add_hunk: "*** Add File: " filename LF add_line+
 *   delete_hunk: "*** Delete File: " filename LF
 *   update_hunk: "*** Update File: " filename LF change_move? change?
 *   filename: /(.+)/
 *   add_line: "+" /(.+)/ LF -> line
 *   change_move: "*** Move to: " filename LF
 *   change: (change_context | change_line)+ eof_line?
 *   change_context: ("@@" | "@@ " /(.+)/) LF
 *   change_line: ("+" | "-" | " ") /(.+)/ LF
 *   eof_line: "*** End of File" LF
 *
 * Lenient mode additionally unwraps a bash heredoc wrapper
 * (`<<EOF` / `<<'EOF'` / `<<"EOF"` … `EOF`) that gpt-4.1-era models sometimes
 * emit, and tolerates leading/trailing whitespace around markers.
 */

/** Begin-patch marker, first line of every patch. */
export const BEGIN_PATCH_MARKER = '*** Begin Patch'
/** End-patch marker, last line of every patch. */
export const END_PATCH_MARKER = '*** End Patch'
const ADD_FILE_MARKER = '*** Add File: '
const DELETE_FILE_MARKER = '*** Delete File: '
const UPDATE_FILE_MARKER = '*** Update File: '
const MOVE_TO_MARKER = '*** Move to: '
const EOF_MARKER = '*** End of File'
const CHANGE_CONTEXT_MARKER = '@@ '
const EMPTY_CHANGE_CONTEXT_MARKER = '@@'

/** One parsed file operation. */
export type PatchHunk =
  | { kind: 'add'; path: string; contents: string }
  | { kind: 'delete'; path: string }
  | { kind: 'update'; path: string; movePath: string | null; chunks: UpdateChunk[] }

/** One contiguous replacement block inside an update hunk. */
export interface UpdateChunk {
  /** Context line (`@@ <text>` / bare `@@`) that anchors the block; null = no anchor. */
  changeContext: string | null
  /** Lines to find and remove (without the `-` marker); empty = pure insertion. */
  oldLines: string[]
  /** Lines to insert (without the `+` marker). */
  newLines: string[]
  /** Whether `*** End of File` follows this block (anchors at file end). */
  isEndOfFile: boolean
}

/** Parse failure with a codex-style message. */
export class PatchParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PatchParseError'
  }
}

/**
 * Parse a patch string into hunks. Mirrors codex's `parse_patch`: strict
 * boundaries first, then a lenient heredoc unwrap, then streaming hunk
 * parsing.
 */
export function parsePatch(patch: string): PatchHunk[] {
  const lines = patch.trim().split('\n')
  const patchLines = checkPatchBoundariesLenient(lines)
  return parseHunks(patchLines.join('\n'))
}

/** Validate `*** Begin Patch` / `*** End Patch` framing (codex strict check). */
function checkPatchBoundariesStrict(lines: string[]): string[] {
  const first = lines[0]?.trim()
  const last = lines[lines.length - 1]?.trim()
  if (first === undefined) {
    throw new PatchParseError("The first line of the patch must be '*** Begin Patch'")
  }
  if (first !== BEGIN_PATCH_MARKER) {
    throw new PatchParseError("The first line of the patch must be '*** Begin Patch'")
  }
  if (last !== END_PATCH_MARKER) {
    throw new PatchParseError("The last line of the patch must be '*** End Patch'")
  }
  return lines
}

/**
 * Strict framing, then — if that failed and the text is a bash heredoc
 * wrapper around a patch — unwrap and re-check. Matches codex's lenient mode
 * for gpt-4.1-style `<<'EOF' ... EOF` arguments.
 */
function checkPatchBoundariesLenient(lines: string[]): string[] {
  try {
    return checkPatchBoundariesStrict(lines)
  } catch (originalError) {
    const first = lines[0]?.trim()
    const last = lines[lines.length - 1]?.trimEnd()
    if (
      (first === '<<EOF' || first === "<<'EOF'" || first === '<<"EOF"') &&
      last?.endsWith('EOF') &&
      lines.length >= 4
    ) {
      const inner = lines.slice(1, -1)
      try {
        return checkPatchBoundariesStrict(inner)
      } catch {
        throw originalError
      }
    }
    throw originalError
  }
}

/**
 * Streaming hunk parser over the patch body (between the begin/end markers).
 * State machine mirroring codex's StreamingPatchParser: each `*** <marker>`
 * line starts a new file hunk; `+`/`-`/` `/`@@` lines accumulate into the
 * current update hunk's chunks; `*** End of File` flags the current chunk.
 */
function parseHunks(body: string): PatchHunk[] {
  const lines = body.split('\n')
  const hunks: PatchHunk[] = []
  let current: PatchHunk | null = null
  let currentChunk: UpdateChunk | null = null
  let seenAnyHunk = false
  let sawEnvironmentId = false

  const closeChunk = () => {
    if (currentChunk !== null) {
      if (current?.kind !== 'update') {
        throw new PatchParseError('internal: chunk outside update hunk')
      }
      current.chunks.push(currentChunk)
      currentChunk = null
    }
  }

  const startUpdateChunk = (changeContext: string | null): UpdateChunk => {
    const chunk: UpdateChunk = {
      changeContext,
      oldLines: [],
      newLines: [],
      isEndOfFile: false,
    }
    currentChunk = chunk
    return chunk
  }

  // TypeScript does not track mutation of a captured variable through helper
  // closures, so expose the current parser state through this typed accessor.
  const activeChunk = (): UpdateChunk | null => currentChunk

  for (let i = 0; i < lines.length; i++) {
    // split('\n') leaves one terminal CR on every CRLF physical line. Codex
    // removes that line terminator before examining patch syntax or contents.
    const raw = lines[i].endsWith('\r') ? lines[i].slice(0, -1) : lines[i]
    const trimmed = raw.trim()
    // Patch headers tolerate surrounding whitespace, but an indented marker in
    // an update hunk is a literal context line, as in Codex's parser.
    const canBeHeader = current?.kind !== 'update' || raw === raw.trimStart()

    if (canBeHeader && (trimmed === BEGIN_PATCH_MARKER || trimmed === END_PATCH_MARKER)) continue
    // Blank separators outside update hunks carry no patch data. This also
    // accepts the common blank line between an Add/Delete body and End Patch.
    if (current?.kind !== 'update' && trimmed === '') continue

    if (canBeHeader && current === null && trimmed.startsWith('*** Environment ID:')) {
      if (sawEnvironmentId) {
        throw new PatchParseError('apply_patch environment_id cannot be specified more than once')
      }
      if (trimmed.slice('*** Environment ID:'.length).trim() === '') {
        throw new PatchParseError('apply_patch environment_id cannot be empty')
      }
      sawEnvironmentId = true
      continue
    }

    if (canBeHeader && trimmed.startsWith(ADD_FILE_MARKER)) {
      closeChunk()
      const path = trimmed.slice(ADD_FILE_MARKER.length).trim()
      if (path === '') {
        throw new PatchParseError(`Invalid hunk on line ${i + 1}: empty path for Add File`)
      }
      current = { kind: 'add', path, contents: '' }
      hunks.push(current)
      seenAnyHunk = true
      continue
    }

    if (canBeHeader && trimmed.startsWith(DELETE_FILE_MARKER)) {
      closeChunk()
      const path = trimmed.slice(DELETE_FILE_MARKER.length).trim()
      if (path === '') {
        throw new PatchParseError(`Invalid hunk on line ${i + 1}: empty path for Delete File`)
      }
      current = { kind: 'delete', path }
      hunks.push(current)
      seenAnyHunk = true
      continue
    }

    if (canBeHeader && trimmed.startsWith(UPDATE_FILE_MARKER)) {
      closeChunk()
      const path = trimmed.slice(UPDATE_FILE_MARKER.length).trim()
      if (path === '') {
        throw new PatchParseError(`Invalid hunk on line ${i + 1}: empty path for Update File`)
      }
      current = { kind: 'update', path, movePath: null, chunks: [] }
      hunks.push(current)
      seenAnyHunk = true
      continue
    }

    if (current === null) {
      if (trimmed === '') continue
      throw new PatchParseError(`Invalid patch: content before any file hunk on line ${i + 1}`)
    }

    if (current.kind === 'update') {
      // Deliberately preserve source-line trailing whitespace. It is data in
      // +/-/space lines, while markers and @@ labels follow Codex's trim_end
      // treatment so marker whitespace remains lenient.
      const updateLine = raw.trimEnd()
      if (updateLine.startsWith(MOVE_TO_MARKER)) {
        closeChunk()
        if (current.movePath !== null) {
          throw new PatchParseError(`Invalid hunk on line ${i + 1}: duplicate Move to`)
        }
        const movePath = updateLine.slice(MOVE_TO_MARKER.length).trim()
        if (movePath === '') {
          throw new PatchParseError(`Invalid hunk on line ${i + 1}: empty path for Move to`)
        }
        current.movePath = movePath
        continue
      }

      if (updateLine === EOF_MARKER) {
        const chunk = activeChunk()
        if (chunk === null || (chunk.oldLines.length === 0 && chunk.newLines.length === 0)) {
          throw new PatchParseError(`Invalid hunk on line ${i + 1}: End of File without a chunk`)
        }
        chunk.isEndOfFile = true
        continue
      }

      if (updateLine === EMPTY_CHANGE_CONTEXT_MARKER || updateLine.startsWith(CHANGE_CONTEXT_MARKER)) {
        closeChunk()
        const ctx = updateLine === EMPTY_CHANGE_CONTEXT_MARKER
          ? null
          : updateLine.slice(CHANGE_CONTEXT_MARKER.length)
        startUpdateChunk(ctx === '' ? null : ctx)
        continue
      }

      if (raw === '') {
        // `parsePatch()` trims the outer document, so an empty line immediately
        // before End Patch is only a separator. Elsewhere Codex treats it as
        // empty context; after an EOF marker it is ignored.
        const nextNonEmpty = lines.slice(i + 1).find((candidate) => candidate.trim() !== '')?.trim()
        const chunk = activeChunk()
        if (chunk?.isEndOfFile || nextNonEmpty === END_PATCH_MARKER) continue
        const targetChunk = chunk ?? startUpdateChunk(null)
        targetChunk.oldLines.push('')
        targetChunk.newLines.push('')
        continue
      }

      const marker = raw[0]
      const content = raw.slice(1)
      if (marker === '+' || marker === '-' || marker === ' ') {
        // Codex allows the first chunk to start without an explicit @@ header.
        const chunk = activeChunk() ?? startUpdateChunk(null)
        if (marker === '+' || marker === ' ') chunk.newLines.push(content)
        if (marker === '-' || marker === ' ') chunk.oldLines.push(content)
        continue
      }

      throw new PatchParseError(`Invalid hunk on line ${i + 1}: unexpected line in update hunk`)
    }

    if (current.kind === 'add') {
      if (!raw.startsWith('+')) {
        throw new PatchParseError(`Invalid hunk on line ${i + 1}: Add File content must start with '+'`)
      }
      current.contents += raw.slice(1) + '\n'
      continue
    }

    if (current.kind === 'delete') {
      throw new PatchParseError(`Invalid hunk on line ${i + 1}: Delete File takes no content lines`)
    }
  }

  closeChunk()

  if (!seenAnyHunk) {
    // Codex: an empty patch (just begin/end) is valid but applies nothing.
    return []
  }

  for (const hunk of hunks) {
    if (hunk.kind === 'update' && hunk.chunks.length === 0) {
      throw new PatchParseError(`Update file hunk for path '${hunk.path}' is empty`)
    }
    if (hunk.kind === 'update' && hunk.chunks.some((chunk) => chunk.oldLines.length === 0 && chunk.newLines.length === 0)) {
      throw new PatchParseError(`Update hunk for path '${hunk.path}' does not contain any lines`)
    }
  }

  return hunks
}
