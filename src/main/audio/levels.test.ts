import { describe, it, expect } from 'vitest'
import { applyGain, peakAbs, peakLevel, gainAndPeakInPlace } from './levels'

const closeAll = (a: Float32Array, b: number[]): void => {
  expect(a.length).toBe(b.length)
  for (let i = 0; i < b.length; i++) expect(a[i]).toBeCloseTo(b[i], 6)
}

describe('peakAbs — bare max absolute sample', () => {
  it('returns the largest |sample|', () => {
    expect(peakAbs(Float32Array.from([0.1, -0.9, 0.3]))).toBeCloseTo(0.9, 6)
    expect(peakAbs(new Float32Array(0))).toBe(0)
  })
})

describe('applyGain — gained = frames * gain (recorder callback)', () => {
  it('scales every sample by the gain', () => {
    closeAll(applyGain(Float32Array.from([0.1, -0.2, 0.3]), 2), [0.2, -0.4, 0.6])
  })
  it('gain 0 zeroes the frame', () => {
    closeAll(applyGain(Float32Array.from([0.5, -0.5]), 0), [0, 0])
  })
})

describe('peakLevel — min(1.0, peak(|gained|) * 3)', () => {
  it('multiplies the absolute peak by 3 and clamps to 1', () => {
    expect(peakLevel(Float32Array.from([0.1, -0.2, 0.05]))).toBeCloseTo(0.6, 6) // 0.2*3
  })
  it('clamps to 1.0', () => {
    expect(peakLevel(Float32Array.from([0.5, -0.9]))).toBe(1) // 0.9*3=2.7 -> 1
  })
  it('is 0 for silence / empty', () => {
    expect(peakLevel(Float32Array.from([0, 0, 0]))).toBe(0)
    expect(peakLevel(new Float32Array(0))).toBe(0)
  })
})

describe('gainAndPeakInPlace — fused hot-path gain + level', () => {
  it('scales the frame in place and returns the same level as applyGain+peakLevel', () => {
    const frame = Float32Array.from([0.1, -0.2, 0.05])
    const level = gainAndPeakInPlace(frame, 2)
    closeAll(frame, [0.2, -0.4, 0.1]) // mutated in place
    expect(level).toBeCloseTo(peakLevel(applyGain(Float32Array.from([0.1, -0.2, 0.05]), 2)), 6)
  })
  it('clamps the level to 1.0', () => {
    expect(gainAndPeakInPlace(Float32Array.from([0.5, -0.9]), 1)).toBe(1)
  })
})
