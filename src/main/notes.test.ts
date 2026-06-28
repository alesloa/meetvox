import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getNotes, saveNotes } from './notes'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'meetvox-notes-test-'))
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('getNotes', () => {
  test('returns empty string when notes.md absent', () => {
    expect(getNotes(tmpDir)).toBe('')
  })

  test('returns empty string on unreadable dir (non-existent path)', () => {
    expect(getNotes(join(tmpDir, 'does-not-exist'))).toBe('')
  })
})

describe('saveNotes / getNotes round-trip', () => {
  test('saves and retrieves plain text', () => {
    saveNotes(tmpDir, 'hello world')
    expect(getNotes(tmpDir)).toBe('hello world')
  })

  test('round-trips text with newlines', () => {
    const text = 'line one\nline two\nline three'
    saveNotes(tmpDir, text)
    expect(getNotes(tmpDir)).toBe(text)
  })

  test('round-trips unicode', () => {
    const text = '🎤 meeting notes — café résumé'
    saveNotes(tmpDir, text)
    expect(getNotes(tmpDir)).toBe(text)
  })

  test('overwrite replaces previous content', () => {
    saveNotes(tmpDir, 'first')
    saveNotes(tmpDir, 'second')
    expect(getNotes(tmpDir)).toBe('second')
  })

  test('saves empty string', () => {
    saveNotes(tmpDir, '')
    expect(getNotes(tmpDir)).toBe('')
  })
})
