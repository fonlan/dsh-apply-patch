/**
 * Parser tests: codex-format compliance (ported expectations from
 * openai/codex's apply-patch parser tests).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parsePatch, PatchParseError, BEGIN_PATCH_MARKER, END_PATCH_MARKER } from '../src/host/parser.js'

const wrap = (body: string) => `${BEGIN_PATCH_MARKER}\n${body}\n${END_PATCH_MARKER}`

describe('parsePatch boundaries', () => {
  it('rejects a non-patch', () => {
    assert.throws(() => parsePatch('bad'), PatchParseError)
    assert.throws(() => parsePatch('bad'), /first line.*Begin Patch/)
  })

  it('rejects a patch missing the end marker', () => {
    assert.throws(() => parsePatch(`${BEGIN_PATCH_MARKER}\n*** Update File: x.py`), PatchParseError)
    assert.throws(
      () => parsePatch(`${BEGIN_PATCH_MARKER}\n*** Update File: x.py`),
      /last line.*End Patch/,
    )
  })

  it('accepts an empty patch (begin/end only) as zero hunks', () => {
    assert.deepEqual(parsePatch(`${BEGIN_PATCH_MARKER}\n${END_PATCH_MARKER}`), [])
  })

  it('tolerates whitespace around markers', () => {
    const hunks = parsePatch(`  ${BEGIN_PATCH_MARKER}  \n*** Add File: foo\n+hi\n${END_PATCH_MARKER}  `)
    assert.deepEqual(hunks, [{ kind: 'add', path: 'foo', contents: 'hi\n' }])
  })

  it('unwraps a lenient bash heredoc wrapper', () => {
    const patch = wrap('*** Update File: file2.py\n import foo\n+bar')
    const heredoc = `<<'EOF'\n${patch}\nEOF\n`
    const hunks = parsePatch(heredoc)
    assert.deepEqual(hunks, [{
      kind: 'update',
      path: 'file2.py',
      movePath: null,
      chunks: [{
        changeContext: null,
        oldLines: ['import foo'],
        newLines: ['import foo', 'bar'],
        isEndOfFile: false,
      }],
    }])
  })

  it('rejects a mismatched heredoc', () => {
    const patch = wrap('*** Update File: f.py\n@@\n-x\n+y')
    assert.throws(() => parsePatch(`<<"EOF'\n${patch}\nEOF\n`), PatchParseError)
  })
})

describe('parsePatch add hunks', () => {
  it('parses a simple add', () => {
    assert.deepEqual(
      parsePatch(wrap('*** Add File: foo\n+hi\n')),
      [{ kind: 'add', path: 'foo', contents: 'hi\n' }],
    )
  })

  it('parses multi-line add preserving newlines', () => {
    assert.deepEqual(
      parsePatch(wrap('*** Add File: path/add.py\n+abc\n+def\n')),
      [{ kind: 'add', path: 'path/add.py', contents: 'abc\ndef\n' }],
    )
  })

  it('rejects content not starting with +', () => {
    assert.throws(() => parsePatch(wrap('*** Add File: foo\nhi\n')), PatchParseError)
  })
})

describe('parsePatch delete hunks', () => {
  it('parses a delete', () => {
    assert.deepEqual(
      parsePatch(wrap('*** Delete File: path/delete.py\n')),
      [{ kind: 'delete', path: 'path/delete.py' }],
    )
  })

  it('rejects content lines after delete', () => {
    assert.throws(() => parsePatch(wrap('*** Delete File: a.py\n+content\n')), PatchParseError)
  })
})

describe('parsePatch update hunks', () => {
  it('parses a context + replace chunk', () => {
    const hunks = parsePatch(wrap('*** Update File: path/update.py\n@@ def f():\n-    pass\n+    return 123\n'))
    assert.deepEqual(hunks, [{
      kind: 'update',
      path: 'path/update.py',
      movePath: null,
      chunks: [{
        changeContext: 'def f():',
        oldLines: ['    pass'],
        newLines: ['    return 123'],
        isEndOfFile: false,
      }],
    }])
  })

  it('parses bare @@ and a context line into one chunk', () => {
    const hunks = parsePatch(wrap('*** Update File: file.py\n@@\n+line\n'))
    assert.deepEqual(hunks, [{
      kind: 'update',
      path: 'file.py',
      movePath: null,
      chunks: [{
        changeContext: null,
        oldLines: [],
        newLines: ['line'],
        isEndOfFile: false,
      }],
    }])
  })

  it('parses a chunk without an @@ header (context line first)', () => {
    const hunks = parsePatch(wrap('*** Update File: file2.py\n import foo\n+bar'))
    assert.deepEqual(hunks, [{
      kind: 'update',
      path: 'file2.py',
      movePath: null,
      chunks: [{
        changeContext: null,
        oldLines: ['import foo'],
        newLines: ['import foo', 'bar'],
        isEndOfFile: false,
      }],
    }])
  })

  it('parses the End of File marker', () => {
    const hunks = parsePatch(wrap('*** Update File: file.txt\n@@\n+quux\n*** End of File'))
    assert.deepEqual(hunks, [{
      kind: 'update',
      path: 'file.txt',
      movePath: null,
      chunks: [{
        changeContext: null,
        oldLines: [],
        newLines: ['quux'],
        isEndOfFile: true,
      }],
    }])
  })

  it('parses Move to', () => {
    const hunks = parsePatch(wrap('*** Update File: path/update.py\n*** Move to: path/update2.py\n@@ def f():\n-    pass\n+    return 123\n'))
    assert.deepEqual(hunks, [{
      kind: 'update',
      path: 'path/update.py',
      movePath: 'path/update2.py',
      chunks: [{
        changeContext: 'def f():',
        oldLines: ['    pass'],
        newLines: ['    return 123'],
        isEndOfFile: false,
      }],
    }])
  })

  it('rejects an empty update hunk', () => {
    assert.throws(() => parsePatch(wrap('*** Update File: test.py\n')), /empty/)
  })

  it('parses multiple hunks in one patch', () => {
    const hunks = parsePatch(wrap([
      '*** Add File: path/add.py',
      '+abc',
      '+def',
      '*** Delete File: path/delete.py',
      '*** Update File: path/update.py',
      '*** Move to: path/update2.py',
      '@@ def f():',
      '-    pass',
      '+    return 123',
    ].join('\n')))
    assert.deepEqual(hunks, [
      { kind: 'add', path: 'path/add.py', contents: 'abc\ndef\n' },
      { kind: 'delete', path: 'path/delete.py' },
      {
        kind: 'update',
        path: 'path/update.py',
        movePath: 'path/update2.py',
        chunks: [{
          changeContext: 'def f():',
          oldLines: ['    pass'],
          newLines: ['    return 123'],
          isEndOfFile: false,
        }],
      },
    ])
  })
})
