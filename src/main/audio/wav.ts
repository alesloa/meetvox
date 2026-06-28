// WAV chunk encoder — a faithful port of recorder_blackhole.py::_write_chunk.
// Byte-for-byte parity is required (validation step 3), so every operation mirrors
// the numpy/wave semantics exactly:
//   - system stereo -> mono via mean of the two channels
//   - truncate both to min length, interleave as [mic, system]
//   - normalize by global peak * 0.9
//   - int16 via truncation toward zero (numpy astype, NOT rounding)
//   - canonical 44-byte PCM WAV header (Python `wave` module output)

import { NORMALIZE_PEAK, INT16_SCALE } from '@shared/constants'
import { peakAbs } from './levels'

export interface ChunkInput {
  /** Concatenated mono mic samples (gain already applied), or null if absent. */
  mic: Float32Array | null
  /** Concatenated interleaved system samples, or null if absent. */
  system: Float32Array | null
  /** Channel count of `system` (2 normally; used to downmix to mono). */
  systemChannels: number
  sampleRate: number
}

export interface EncodedChunk {
  /** Complete WAV file bytes, or null when there was nothing to write. */
  wav: Uint8Array | null
  channels: number
}

/** Downmix interleaved multi-channel float samples to mono by averaging channels. */
function downmixToMono(interleaved: Float32Array, channels: number): Float32Array {
  if (channels <= 1) return interleaved
  const frames = Math.floor(interleaved.length / channels)
  const mono = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    let sum = 0
    const base = f * channels
    for (let c = 0; c < channels; c++) sum += interleaved[base + c]
    mono[f] = sum / channels
  }
  return mono
}

export function encodeChunk(input: ChunkInput): EncodedChunk {
  const { mic, system, systemChannels, sampleRate } = input

  const micMono = mic // already mono
  const sysMono = system ? downmixToMono(system, systemChannels) : null

  if (!micMono && !sysMono) return { wav: null, channels: 0 }

  let interleaved: Float32Array
  let channels: number

  if (micMono && sysMono) {
    const minLen = Math.min(micMono.length, sysMono.length)
    channels = 2
    interleaved = new Float32Array(minLen * 2)
    for (let i = 0; i < minLen; i++) {
      interleaved[i * 2] = micMono[i] // left = mic = "You"
      interleaved[i * 2 + 1] = sysMono[i] // right = system = "Other"
    }
  } else {
    const only = (micMono ?? sysMono) as Float32Array
    channels = 1
    interleaved = only
  }

  // Normalize by global peak to 0.9 (per-chunk, matches Python — intentional).
  const maxVal = peakAbs(interleaved)
  const scale = maxVal > 0 ? (1 / maxVal) * NORMALIZE_PEAK : 1

  // int16 via truncation toward zero, exactly like numpy `astype(np.int16)`.
  const samples = new Int16Array(interleaved.length)
  for (let i = 0; i < interleaved.length; i++) {
    samples[i] = Math.trunc(interleaved[i] * scale * INT16_SCALE)
  }

  return { wav: buildWav(samples, channels, sampleRate), channels }
}

/** Build a canonical 44-byte-header PCM WAV (matches Python `wave` output). */
function buildWav(samples: Int16Array, channels: number, sampleRate: number): Uint8Array {
  const bytesPerSample = 2
  const dataLen = samples.length * bytesPerSample
  const blockAlign = channels * bytesPerSample
  const byteRate = sampleRate * blockAlign

  const buf = Buffer.alloc(44 + dataLen)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(36 + dataLen, 4)
  buf.write('WAVE', 8, 'ascii')
  buf.write('fmt ', 12, 'ascii')
  buf.writeUInt32LE(16, 16) // PCM fmt chunk size
  buf.writeUInt16LE(1, 20) // audioFormat = PCM
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(byteRate, 28)
  buf.writeUInt16LE(blockAlign, 32)
  buf.writeUInt16LE(16, 34) // bits per sample
  buf.write('data', 36, 'ascii')
  buf.writeUInt32LE(dataLen, 40)
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 44 + i * 2)

  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

export interface WavMeta {
  channels: number
  sampleRate: number
  frames: number
  durationSec: number
}

/** Minimal WAV reader: pull channels/rate/frame-count → duration (pipeline needs chunk_duration). */
export function readWavDuration(buf: Buffer): WavMeta {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('Not a RIFF/WAV buffer')
  }
  // Walk chunks to find fmt + data (robust to extra chunks, though we write canonical).
  let channels = 0
  let sampleRate = 0
  let bitsPerSample = 16
  let dataLen = 0
  let offset = 12
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(offset + 10)
      sampleRate = buf.readUInt32LE(offset + 12)
      bitsPerSample = buf.readUInt16LE(offset + 22)
    } else if (id === 'data') {
      dataLen = size
    }
    offset += 8 + size + (size % 2) // chunks are word-aligned
  }
  const bytesPerFrame = channels * (bitsPerSample / 8)
  const frames = bytesPerFrame > 0 ? Math.floor(dataLen / bytesPerFrame) : 0
  return {
    channels,
    sampleRate,
    frames,
    durationSec: sampleRate > 0 ? frames / sampleRate : 0
  }
}
