// Gain + VU level math, ported from recorder_blackhole.py callbacks and VUMeter.
//   gained = frames * gain
//   level  = min(1.0, peak(|gained|) * 3)
//   color  = green < 0.6 <= yellow < 0.85 <= red

import { LEVEL_MULTIPLIER } from '@shared/constants'

/** Bare peak of absolute sample value. Shared by peakLevel and the WAV normalizer. */
export function peakAbs(frame: Float32Array): number {
  let peak = 0
  for (let i = 0; i < frame.length; i++) {
    const a = Math.abs(frame[i])
    if (a > peak) peak = a
  }
  return peak
}

export function applyGain(frame: Float32Array, gain: number): Float32Array {
  const out = new Float32Array(frame.length)
  for (let i = 0; i < frame.length; i++) out[i] = frame[i] * gain
  return out
}

/** min(1.0, peak(|frame|) * 3). Pass the gained frame (matches Python's `gained`). */
export function peakLevel(gainedFrame: Float32Array): number {
  return Math.min(1, peakAbs(gainedFrame) * LEVEL_MULTIPLIER)
}

/**
 * Hot-path fusion of applyGain + peakLevel: scales `frame` in place and returns
 * its VU level in a single pass with no extra allocation. The recorder owns the
 * frame buffer (a fresh copy from pcmFloat32), so mutating it is safe.
 */
export function gainAndPeakInPlace(frame: Float32Array, gain: number): number {
  let peak = 0
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i] * gain
    frame[i] = v
    const a = v < 0 ? -v : v
    if (a > peak) peak = a
  }
  return Math.min(1, peak * LEVEL_MULTIPLIER)
}
