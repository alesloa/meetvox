import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { PROGRESS_FILE, readProgress, savePiece, clearProgress, progressCounts } from './progress'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'meetvox-progress-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('progress file — the pieces a stopped transcription already finished', () => {
  it('reads as empty when there is no progress file', () => {
    expect(readProgress(dir)).toEqual({})
  })

  it('round-trips a saved piece', () => {
    savePiece(dir, 'chunk_000.wav', [{ time: 0, speaker: 'You', text: 'hi' }])
    expect(readProgress(dir)).toEqual({
      'chunk_000.wav': [{ time: 0, speaker: 'You', text: 'hi' }]
    })
  })

  it('adds a piece without losing the earlier ones', () => {
    savePiece(dir, 'chunk_000.wav', [{ time: 0, speaker: 'You', text: 'one' }])
    savePiece(dir, 'chunk_001.wav', [])
    expect(Object.keys(readProgress(dir))).toEqual(['chunk_000.wav', 'chunk_001.wav'])
    expect(readProgress(dir)['chunk_001.wav']).toEqual([])
  })

  it('reads a corrupt progress file as empty instead of throwing', () => {
    writeFileSync(join(dir, PROGRESS_FILE), '{not json')
    expect(readProgress(dir)).toEqual({})
  })

  it('clearProgress removes the file', () => {
    savePiece(dir, 'chunk_000.wav', [])
    clearProgress(dir)
    expect(existsSync(join(dir, PROGRESS_FILE))).toBe(false)
    clearProgress(dir) // no file: still fine
  })
})

describe('progressCounts — "stopped at N of M" for a meeting', () => {
  it('is null when nothing was saved', () => {
    writeFileSync(join(dir, 'chunk_000.wav'), 'x')
    expect(progressCounts(dir)).toBeNull()
  })

  it('counts saved pieces against the chunk files', () => {
    for (const n of ['000', '001', '002']) writeFileSync(join(dir, `chunk_${n}.wav`), 'x')
    savePiece(dir, 'chunk_000.wav', [])
    savePiece(dir, 'chunk_001.wav', [])
    expect(progressCounts(dir)).toEqual({ done: 2, total: 3 })
  })
})
