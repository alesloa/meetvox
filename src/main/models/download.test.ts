import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, truncateSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { modelDir, modelFilePath, computeFraction, isModelPresent, checkDownload } from './download'
import { LOCAL_MODELS, type LocalModel } from '@shared/transcription'

const TURBO = LOCAL_MODELS[0]

describe('model paths — ~/.meetvox/models', () => {
  it('builds the model dir and the per-model file path under the home dir', () => {
    expect(modelDir('/home/user')).toBe('/home/user/.meetvox/models')
    expect(modelFilePath('/home/user', 'ggml-large-v3-turbo.bin')).toBe(
      '/home/user/.meetvox/models/ggml-large-v3-turbo.bin'
    )
  })
})

describe('computeFraction — progress bar value', () => {
  it('is received/total when total is known', () => {
    expect(computeFraction(50, 100)).toBeCloseTo(0.5, 6)
    expect(computeFraction(0, 100)).toBe(0)
    expect(computeFraction(100, 100)).toBe(1)
  })
  it('is -1 when total is unknown', () => {
    expect(computeFraction(50, 0)).toBe(-1)
    expect(computeFraction(50, -1)).toBe(-1)
  })
})

describe('isModelPresent — exact size, so a truncated file never counts', () => {
  let home: string
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'meetvox-models-'))
    mkdirSync(modelDir(home), { recursive: true })
  })
  afterEach(() => rmSync(home, { recursive: true, force: true }))

  it('is false when the file is missing', () => {
    expect(isModelPresent(home, TURBO)).toBe(false)
  })

  it('is true only at the exact catalog size', () => {
    const path = modelFilePath(home, TURBO.file)
    writeFileSync(path, '')
    truncateSync(path, TURBO.bytes - 1) // sparse — no real disk use
    expect(isModelPresent(home, TURBO)).toBe(false)
    truncateSync(path, TURBO.bytes)
    expect(isModelPresent(home, TURBO)).toBe(true)
  })
})

describe('checkDownload — size and SHA-256 must both match the catalog', () => {
  const model: LocalModel = { ...TURBO, bytes: 3, sha256: 'abc' }

  it('passes when both match', () => {
    expect(checkDownload({ bytes: 3, sha256: 'abc' }, model)).toBeNull()
  })

  it('names the size mismatch', () => {
    expect(checkDownload({ bytes: 2, sha256: 'abc' }, model)).toBe(
      'Model download incomplete: got 2 of 3 bytes'
    )
  })

  it('names the checksum mismatch', () => {
    expect(checkDownload({ bytes: 3, sha256: 'def' }, model)).toBe(
      'Model download is corrupt: SHA-256 does not match'
    )
  })
})
