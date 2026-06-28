import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { encodeChunk, readWavDuration } from './wav'

interface GoldenCase {
  name: string
  mic: number[] | null
  systemInterleaved: number[] | null
  systemChannels: number
  expectedChannels: number
  expectedWavBase64: string | null
}
interface Golden {
  sampleRate: number
  cases: GoldenCase[]
}

const golden: Golden = JSON.parse(
  readFileSync(resolve(__dirname, '__fixtures__/wav-golden.json'), 'utf8')
)

const toF32 = (a: number[] | null): Float32Array | null =>
  a === null ? null : Float32Array.from(a)

describe('encodeChunk — byte parity with recorder_blackhole.py::_write_chunk', () => {
  for (const c of golden.cases) {
    it(`matches Python bytes for case "${c.name}"`, () => {
      const out = encodeChunk({
        mic: toF32(c.mic),
        system: toF32(c.systemInterleaved),
        systemChannels: c.systemChannels,
        sampleRate: golden.sampleRate
      })
      expect(out.channels).toBe(c.expectedChannels)
      const got = Buffer.from(out.wav!).toString('base64')
      expect(got).toBe(c.expectedWavBase64)
    })
  }
})

describe('encodeChunk — edge cases', () => {
  it('returns null wav when both sources are absent', () => {
    const out = encodeChunk({ mic: null, system: null, systemChannels: 0, sampleRate: 44100 })
    expect(out.wav).toBeNull()
    expect(out.channels).toBe(0)
  })
})

describe('readWavDuration', () => {
  it('reads frames/rate from a chunk encoded by encodeChunk', () => {
    // 4 mono samples + 4 mono system (2 stereo frames) -> min_len 2 frames stereo.
    const out = encodeChunk({
      mic: Float32Array.from([0.1, 0.2, 0.3, 0.4]),
      system: Float32Array.from([0.5, 0.5, 0.6, 0.6]),
      systemChannels: 2,
      sampleRate: 44100
    })
    const d = readWavDuration(Buffer.from(out.wav!))
    expect(d.channels).toBe(2)
    expect(d.sampleRate).toBe(44100)
    expect(d.frames).toBe(2)
    expect(d.durationSec).toBeCloseTo(2 / 44100, 10)
  })
})
