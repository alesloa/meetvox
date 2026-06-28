import { describe, it, expect } from 'vitest'
import { ChunkAccumulator } from './accumulator'

const closeAll = (a: Float32Array, b: number[]): void => {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < b.length; i++) expect(a[i]).toBeCloseTo(b[i], 6)
}

describe('ChunkAccumulator — buffers gained frames, concatenates and clears on flush', () => {
  it('concatenates mic frames (mono) and system frames (interleaved) in order', () => {
    const acc = new ChunkAccumulator(2)
    acc.pushMic(Float32Array.from([0.1, 0.2]))
    acc.pushMic(Float32Array.from([0.3]))
    acc.pushSystem(Float32Array.from([0.4, 0.5])) // 1 stereo frame
    acc.pushSystem(Float32Array.from([0.6, 0.7])) // 1 stereo frame

    const flushed = acc.flush()
    closeAll(flushed.mic!, [0.1, 0.2, 0.3])
    closeAll(flushed.system!, [0.4, 0.5, 0.6, 0.7])
    expect(flushed.systemChannels).toBe(2)
  })

  it('clears buffers after flush (no data carried over)', () => {
    const acc = new ChunkAccumulator(2)
    acc.pushMic(Float32Array.from([1]))
    expect(acc.hasData()).toBe(true)
    acc.flush()
    expect(acc.hasData()).toBe(false)
    expect(acc.flush().mic).toBeNull()
  })

  it('returns null for a stream with no frames', () => {
    const acc = new ChunkAccumulator(2)
    acc.pushSystem(Float32Array.from([0.1, 0.2]))
    const f = acc.flush()
    expect(f.mic).toBeNull()
    closeAll(f.system!, [0.1, 0.2])
  })

  it('hasData is false on a fresh accumulator', () => {
    expect(new ChunkAccumulator(2).hasData()).toBe(false)
  })
})
