/**
 * The `apply_patch` tool definition.
 *
 * Model-facing name and argument shape mirror OpenAI Codex's apply_patch
 * tool ({"command":["apply_patch","*** Begin Patch\n..."]}) so GPT-family
 * models that were trained on codex call it without adaptation: one `patch`
 * argument carrying the full codex patch document.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { FileSystem, FsTarget, FsWriteIntent } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type { ShellExecutor } from '@deepseek-ai/dsh-shell'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { parsePatch, PatchParseError } from './parser.js'
import { applyHunks, renderSummary, type ApplyPatchCapabilities } from './applier.js'

/** Model-facing description (codex-style, terse and unambiguous). */
export const APPLY_PATCH_DESCRIPTION = [
  'Apply a codex-style patch to files in the workspace. The patch uses the exact format OpenAI Codex trained models emit:',
  '',
  '```',
  '*** Begin Patch',
  '*** Update File: path/to/file.py',
  '@@ optional context line',
  '- line to remove',
  '+ line to add',
  ' context line',
  '*** Add File: path/to/new.py',
  '+file content',
  '*** Delete File: path/to/old.py',
  '*** End Patch',
  '```',
  '',
  'Rules:',
  '* The first line must be `*** Begin Patch` and the last `*** End Patch`.',
  '* `*** Update File:` edits an existing file; hunks are blocks of `-`/`+`/` ` lines, optionally anchored by an `@@ context` line. Context must match exactly (whitespace-insensitive fallbacks apply).',
  '* `*** Add File:` creates a new file; every content line must start with `+`. Fails if the file already exists.',
  '* `*** Delete File:` removes an existing file (through the sandbox).',
  '* `*** Move to:` (inside an Update hunk) writes the updated content to the destination path and removes the original.',
  '* `*** End of File` inside an Update hunk anchors the following block at the end of the file.',
  '* All paths are resolved against the session working directory.',
  '* All writes go through the DSH sandbox: a denied operation returns a `[sandbox: ...]` error — do not retry another way.',
].join('\n')

/** Capability faces the tool needs from the host composition. */
export interface ToolFaces {
  fs: FileSystem
  /** Sandboxed shell; absent when the deployment mounts none (Delete then errors). */
  shell: ShellExecutor | undefined
  /** Resolve the per-session sandbox policy for one execution. */
  resolvePolicy(exec: ToolExecution): SandboxExecutionPolicy | undefined
  /** Session workspace cwd (relative hunk paths resolve against it). */
  resolveCwd(exec: ToolExecution): string | undefined
}

/** Register the apply_patch tool (host side). */
export function registerApplyPatchTool(
  ctx: Context,
  faces: ToolFaces,
): () => void {
  return ctx.tools.register(defineTool({
    name: 'apply_patch',
    description: APPLY_PATCH_DESCRIPTION,
    parameters: {
      patch: {
        type: 'string',
        required: true,
        description: 'The full codex-format patch document, starting with `*** Begin Patch` and ending with `*** End Patch`.',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const patch: unknown = args.patch
      if (typeof patch !== 'string' || patch.trim().length === 0) {
        throw new Error('apply_patch: the `patch` argument must be a non-empty string')
      }
      let hunks
      try {
        hunks = parsePatch(patch)
      } catch (error) {
        if (error instanceof PatchParseError) throw error
        throw error
      }

      const policy = faces.resolvePolicy(exec)
      const cwd = faces.resolveCwd(exec)
      const resolveTarget = (path: string): Promise<FsTarget> =>
        faces.fs.resolve(path, {
          ...cwd !== undefined ? { cwd } : {},
          signal: exec.signal,
        })

      const capabilities: ApplyPatchCapabilities = {
        fs: faces.fs,
        shell: faces.shell,
        observe: (target, observation) => {
          ctx.emit('fs/observed', target, observation, exec)
        },
        writeIntent: (target: FsTarget): Promise<FsWriteIntent | undefined> =>
          ctx.waterfall('fs/write-intent', target, exec, () => undefined),
      }

      const affected = await applyHunks(
        hunks,
        resolveTarget,
        capabilities,
        policy,
        exec.signal,
      )
      return renderSummary(affected)
    },
  }))
}
