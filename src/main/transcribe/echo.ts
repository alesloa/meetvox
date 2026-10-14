// Echo gate. Without headphones the mic hears the speakers, so the "You" channel repeats
// what the other side said a moment earlier and both speakers get the same words. Before
// transcribing, mute the parts of the mic channel that are only that echo: the mic loudness
// follows the system channel's 0-300 ms later and the system side is louder. Where the
// system side is silent, or you talk over it, the mic is left alone.

import { readFileSync, writeFileSync } from 'fs'
import { readWavDuration, type WavMeta } from '../audio/wav'

// Measured on real recordings: the mic heard the speakers 8-132 ms late, echo windows
// matched the system channel at 0.5-0.9, and speech in the room at 0.1-0.4.
const MAX_DELAY_MS = 300
const MATCH = 0.5
/** Each 500 ms step is judged on the 2 s around it. */
const STEP_MS = 500
const BEFORE_MS = 750
const AFTER_MS = 1250
const SMOOTH_MS = 10
const FADE_MS = 20

/** Trailing moving average over `n` values. */
function movingAverage(x: Float64Array, n: number): Float64Array {
  const out = new Float64Array(x.length)
  let sum = 0
  for (let i = 0; i < x.length; i++) {
    sum += x[i]
    if (i >= n) sum -= x[i - n]
    out[i] = sum / Math.min(i + 1, n)
  }
  return out
}

/** Loudness envelope, one value per ms: mean |sample|, smoothed over 10 ms. */
function envelope(x: Int16Array, perMs: number, ms: number): Float64Array {
  const raw = new Float64Array(ms)
  for (let m = 0; m < ms; m++) {
    let sum = 0
    for (let i = m * perMs; i < (m + 1) * perMs; i++) sum += Math.abs(x[i])
    raw[m] = sum / perMs
  }
  return movingAverage(raw, SMOOTH_MS)
}

function energy(x: Int16Array, from: number, to: number): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += x[i] * x[i]
  return sum
}

function demean(x: Float64Array): Float64Array {
  const mean = x.reduce((a, b) => a + b, 0) / x.length
  return x.map((v) => v - mean)
}

/** How closely the mic envelope follows the system envelope 0-300 ms later (0..1). */
function echoMatch(mic: Float64Array, system: Float64Array): number {
  const l = demean(mic)
  const r = demean(system)
  let ll = 0
  let rr = 0
  for (let i = 0; i < l.length; i++) {
    ll += l[i] * l[i]
    rr += r[i] * r[i]
  }
  if (ll === 0 || rr === 0) return 0
  let best = 0
  for (let k = 0; k <= MAX_DELAY_MS && k < l.length; k += 2) {
    let c = 0
    for (let i = k; i < l.length; i++) c += l[i] * r[i - k]
    if (c > best) best = c
  }
  return best / Math.sqrt(ll * rr)
}

/** The mic samples with the speaker echo muted (20 ms fades, so the cuts don't click). */
export function muteEcho(mic: Int16Array, system: Int16Array, rate: number): Int16Array {
  const perMs = Math.floor(rate / 1000)
  const ms = Math.floor(Math.min(mic.length, system.length) / perMs)
  const out = Int16Array.from(mic)
  if (ms === 0) return out

  const eMic = envelope(mic, perMs, ms)
  const eSys = envelope(system, perMs, ms)
  const gain = new Float64Array(ms).fill(1)
  for (let c = 0; c < ms; c += STEP_MS) {
    const end = Math.min(ms, c + STEP_MS)
    const from = Math.max(0, c - BEFORE_MS)
    const to = Math.min(ms, c + AFTER_MS)
    if (
      energy(system, c * perMs, end * perMs) > energy(mic, c * perMs, end * perMs) &&
      echoMatch(eMic.subarray(from, to), eSys.subarray(from, to)) > MATCH
    ) {
      gain.fill(0, c, end)
    }
  }

  const fade = movingAverage(gain, FADE_MS)
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.round(out[i] * fade[Math.min(ms - 1, Math.floor(i / perMs))])
  }
  return out
}

function pcm16(buf: Buffer): WavMeta & { samples: Int16Array } {
  const wav = readWavDuration(buf)
  const start = buf.byteOffset + wav.dataOffset
  return { ...wav, samples: new Int16Array(buf.buffer.slice(start, start + wav.frames * 2)) }
}

/** Mute the echo in a split mic wav in place, using the split system wav as the reference. */
export function muteEchoInFile(micPath: string, systemPath: string): void {
  const micBuf = readFileSync(micPath)
  const mic = pcm16(micBuf)
  const system = pcm16(readFileSync(systemPath))
  const out = muteEcho(mic.samples, system.samples, mic.sampleRate)
  Buffer.from(out.buffer, out.byteOffset, out.byteLength).copy(micBuf, mic.dataOffset)
  writeFileSync(micPath, micBuf)
}
