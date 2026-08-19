/**
 * Applier tests: line transformation semantics (port of codex's
 * compute_replacements / apply_replacements behavior).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { deriveNewContents, ApplyError, shellQuote } from '../src/host/applier.js'

describe('deriveNewContents', () => {
  it('replaces a literal block with context anchor', () => {
    const out = deriveNewContents(
      'def f():\n    pass\n',
      'x.py',
      [{
        changeContext: 'def f():',
        oldLines: ['    pass'],
        newLines: ['    return 123'],
        isEndOfFile: false,
      }],
    )
    assert.equal(out, 'def f():\n    return 123\n')
  })

  it('inserts after a context anchor', () => {
    const out = deriveNewContents(
      'a\nb\nc\n',
      'x.txt',
      [{
        changeContext: 'a',
        oldLines: [],
        newLines: ['a1', 'a2'],
        isEndOfFile: false,
      }],
    )
    // Pure addition inserts at end of file (codex semantics: old_lines empty).
    assert.equal(out, 'a\nb\nc\na1\na2\n')
  })

  it('appends at end of file for a pure addition', () => {
    const out = deriveNewContents(
      'a\n',
      'x.txt',
      [{
        changeContext: null,
        oldLines: [],
        newLines: ['tail'],
        isEndOfFile: true,
      }],
    )
    assert.equal(out, 'a\ntail\n')
  })

  it('matches context with whitespace tolerance (rstrip)', () => {
    const out = deriveNewContents(
      'def f():   \n    pass\n',
      'x.py',
      [{
        changeContext: 'def f():',
        oldLines: ['    pass'],
        newLines: ['    return 1'],
        isEndOfFile: false,
      }],
    )
    assert.equal(out, 'def f():   \n    return 1\n')
  })

  it('handles multiple chunks in order', () => {
    const out = deriveNewContents(
      'one\ntwo\nthree\nfour\n',
      'x.txt',
      [
        {
          changeContext: null,
          oldLines: ['two'],
          newLines: ['TWO'],
          isEndOfFile: false,
        },
        {
          changeContext: null,
          oldLines: ['four'],
          newLines: ['FOUR'],
          isEndOfFile: false,
        },
      ],
    )
    assert.equal(out, 'one\nTWO\nthree\nFOUR\n')
  })

  it('errors when old lines are not found', () => {
    assert.throws(
      () => deriveNewContents('a\nb\n', 'x.txt', [{
        changeContext: null,
        oldLines: ['zzz'],
        newLines: ['x'],
        isEndOfFile: false,
      }]),
      ApplyError,
    )
    assert.throws(
      () => deriveNewContents('a\nb\n', 'x.txt', [{
        changeContext: null,
        oldLines: ['zzz'],
        newLines: ['x'],
        isEndOfFile: false,
      }]),
      /Failed to find expected lines in x\.txt:\nzzz/,
    )
  })

  it('errors when the context anchor is not found', () => {
    assert.throws(
      () => deriveNewContents('a\nb\n', 'x.txt', [{
        changeContext: 'missing ctx',
        oldLines: ['a'],
        newLines: ['x'],
        isEndOfFile: false,
      }]),
      /Failed to find context 'missing ctx' in x\.txt/,
    )
  })

  it('handles the trailing-empty sentinel (EOF-touching replacement)', () => {
    const out = deriveNewContents(
      'a\nb\n',
      'x.txt',
      [{
        changeContext: null,
        oldLines: ['b', ''],
        newLines: ['B', ''],
        isEndOfFile: false,
      }],
    )
    assert.equal(out, 'a\nB\n')
  })

  it('preserves file without trailing newline by adding one', () => {
    const out = deriveNewContents(
      'no-newline',
      'x.txt',
      [{
        changeContext: null,
        oldLines: ['no-newline'],
        newLines: ['no-newline!'],
        isEndOfFile: false,
      }],
    )
    assert.equal(out, 'no-newline!\n')
  })
})

describe('shellQuote', () => {
  it('quotes simple paths', () => {
    assert.equal(shellQuote('/tmp/a b.txt'), `'/tmp/a b.txt'`)
  })
  it('escapes embedded single quotes', () => {
    assert.equal(shellQuote("/tmp/it's.txt"), `'/tmp/it'\\''s.txt'`)
  })
})
