import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { muteEcho, muteEchoInFile } from './echo'

const RATE = 16000

/** Seeded random numbers, so every run builds the same audio. */
function rng(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** Speech-like test audio: noise bursts of 100-400 ms with 50-300 ms gaps. */
function voice(seed: number, seconds: number, amp: number): Float32Array {
  const r = rng(seed)
  const out = new Float32Array(seconds * RATE)
  let i = 0
  while (i < out.length) {
    const burst = Math.floor((0.1 + 0.3 * r()) * RATE)
    const level = amp * (0.5 + 0.5 * r())
    for (let j = 0; j < burst && i < out.length; j++, i++) out[i] = level * (2 * r() - 1)
    i += Math.floor((0.05 + 0.25 * r()) * RATE)
  }
  return out
}

/** The same sound, later and quieter: what a mic hears from the speakers. */
function echoOf(x: Float32Array, delayMs: number, gain: number): Float32Array {
  const d = Math.round((delayMs / 1000) * RATE)
  const out = new Float32Array(x.length)
  for (let i = d; i < x.length; i++) out[i] = gain * x[i - d]
  return out
}

const mix = (...xs: Float32Array[]): Float32Array =>
  xs[0].map((_, i) => xs.reduce((sum, x) => sum + x[i], 0))

const pcm = (x: Float32Array): Int16Array => Int16Array.from(x, (v) => Math.round(v * 32767))

function rms(x: Int16Array, from = 0, to = x.length): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += x[i] * x[i]
  return Math.sqrt(sum / Math.max(1, to - from))
}

describe('muteEcho', () => {
  it('mutes a mic that only hears the speakers', () => {
    const system = voice(1, 10, 0.6)
    const mic = pcm(echoOf(system, 80, 0.05))
    const out = muteEcho(mic, pcm(system), RATE)
    expect(rms(out) / rms(mic)).toBeLessThan(0.05)
  })

  it('mutes the echo when the system side was recorded later than the mic', () => {
    // The two sides are captured separately; a real recording had the system side 200 ms late.
    const talk = voice(8, 10, 0.6)
    const mic = pcm(echoOf(talk, 0, 0.05))
    const out = muteEcho(mic, pcm(echoOf(talk, 200, 1)), RATE)
    expect(rms(out) / rms(mic)).toBeLessThan(0.05)
  })

  it('leaves the mic alone when the system side is silent', () => {
    const mic = pcm(voice(2, 10, 0.5))
    const out = muteEcho(mic, new Int16Array(mic.length), RATE)
    expect(out).toEqual(mic)
  })

  it('keeps your own voice and mutes only the echo', () => {
    // First 5 s: the other side talks and the mic hears it. Last 5 s: only you talk.
    const half = 5 * RATE
    const system = voice(3, 10, 0.6)
    system.fill(0, half)
    const own = voice(4, 10, 0.5)
    own.fill(0, 0, half)
    const mic = pcm(mix(echoOf(system, 120, 0.05), own))
    const out = muteEcho(mic, pcm(system), RATE)
    const edge = RATE // skip 1 s around the switch
    expect(rms(out, 0, half - edge) / rms(mic, 0, half - edge)).toBeLessThan(0.05)
    expect(out.slice(half + edge)).toEqual(mic.slice(half + edge))
  })

  it('keeps your voice when you talk over the other side', () => {
    const system = voice(5, 10, 0.6)
    const mic = pcm(mix(voice(6, 10, 0.5), echoOf(system, 60, 0.05)))
    const out = muteEcho(mic, pcm(system), RATE)
    expect(rms(out) / rms(mic)).toBeGreaterThan(0.9)
  })
})

/** A 16-bit mono WAV with a LIST chunk before the data, the way ffmpeg writes it. */
function wavWithList(samples: Int16Array): Buffer {
  const list = Buffer.from('INFOISFT\x0e\x00\x00\x00Lavf61.7.100\x00\x00', 'latin1')
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)
  const head = Buffer.alloc(36)
  head.write('RIFF', 0, 'ascii')
  head.writeUInt32LE(4 + 24 + 8 + list.length + 8 + data.length, 4)
  head.write('WAVE', 8, 'ascii')
  head.write('fmt ', 12, 'ascii')
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20) // PCM
  head.writeUInt16LE(1, 22) // mono
  head.writeUInt32LE(RATE, 24)
  head.writeUInt32LE(RATE * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  const listHead = Buffer.alloc(8)
  listHead.write('LIST', 0, 'ascii')
  listHead.writeUInt32LE(list.length, 4)
  const dataHead = Buffer.alloc(8)
  dataHead.write('data', 0, 'ascii')
  dataHead.writeUInt32LE(data.length, 4)
  return Buffer.concat([head, listHead, list, dataHead, data])
}

describe('muteEchoInFile', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'meetvox-echo-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('rewrites only the mic samples and keeps the header and the system file', () => {
    const system = voice(7, 6, 0.6)
    const mic = pcm(echoOf(system, 90, 0.05))
    const micPath = join(dir, 'left.wav')
    const sysPath = join(dir, 'right.wav')
    const micBefore = wavWithList(mic)
    const sysBefore = wavWithList(pcm(system))
    writeFileSync(micPath, micBefore)
    writeFileSync(sysPath, sysBefore)

    muteEchoInFile(micPath, sysPath)

    const micAfter = readFileSync(micPath)
    const dataAt = micBefore.length - mic.byteLength
    expect(micAfter.length).toBe(micBefore.length)
    expect(micAfter.subarray(0, dataAt)).toEqual(micBefore.subarray(0, dataAt))
    const out = new Int16Array(new Uint8Array(micAfter.subarray(dataAt)).buffer)
    expect(rms(out) / rms(mic)).toBeLessThan(0.05)
    expect(readFileSync(sysPath)).toEqual(sysBefore)
  })
})
