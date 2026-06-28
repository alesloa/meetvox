// Recorder — owns the mic stream (naudiodon, 1ch) and the system source (2ch),
// applies gain, computes VU levels, buffers frames, and flushes stereo WAV chunks
// every `interval` seconds. A faithful port of recorder_blackhole.py's recording
// path (record_mic / record_system / check_auto_save / save_chunk / _write_chunk),
// built on the unit-tested primitives (ChunkAccumulator, applyGain, peakLevel,
// encodeChunk).

import { EventEmitter } from 'events'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { SAMPLE_RATE, MIC_CHANNELS, LEVELS_INTERVAL_MS, GAIN_DEFAULT } from '@shared/constants'
import { pad2 } from '@shared/format'
import { ChunkAccumulator } from './accumulator'
import { gainAndPeakInPlace } from './levels'
import { encodeChunk } from './wav'
import { pcmFloat32 } from './pcm'
import type { SystemSource } from './systemSource'
import type { Gains, Levels, RecorderStatus } from '@shared/types'

/** "meeting_YYYYMMDD_HHMMSS" — matches the Python session folder name. */
export function sessionName(d: Date): string {
  return (
    `meeting_${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_` +
    `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  )
}

export interface RecorderStartOptions {
  micId: number
  systemSource: SystemSource
  gains: Gains
  intervalSec: number
  recordingsRoot: string
  now?: () => Date
}

export interface RecorderEvents {
  levels: (levels: Levels) => void
  status: (status: RecorderStatus) => void
}

export class Recorder extends EventEmitter {
  private accumulator = new ChunkAccumulator(2)
  private gains: Gains = { mic: GAIN_DEFAULT, system: GAIN_DEFAULT }
  private micLevel = 0
  private systemLevel = 0
  private chunkNumber = 0
  private sessionDir: string | null = null
  private systemSource: SystemSource | null = null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private micIo: any = null
  private levelsTimer: NodeJS.Timeout | null = null
  private flushTimer: NodeJS.Timeout | null = null
  private recording = false

  getSessionDir(): string | null {
    return this.sessionDir
  }

  isRecording(): boolean {
    return this.recording
  }

  setGain(gains: Gains): void {
    this.gains = gains
  }

  async start(opts: RecorderStartOptions): Promise<string> {
    if (this.recording) throw new Error('Already recording')
    this.gains = opts.gains
    this.accumulator = new ChunkAccumulator(opts.systemSource.channels)
    this.chunkNumber = 0
    this.micLevel = 0
    this.systemLevel = 0

    const now = (opts.now ?? (() => new Date()))()
    this.sessionDir = join(opts.recordingsRoot, sessionName(now))
    mkdirSync(this.sessionDir, { recursive: true })

    // System source (Mac syscap / Win WASAPI) -> 2ch interleaved float frames.
    this.systemSource = opts.systemSource
    try {
      await this.systemSource.start(
        (interleaved) => {
          // systemSource hands us a fresh Float32Array, so gain it in place.
          this.systemLevel = gainAndPeakInPlace(interleaved, this.gains.system)
          this.accumulator.pushSystem(interleaved)
        },
        (err) => this.emitStatus('error', `System audio error: ${err.message}`)
      )
    } catch (_e) {
      // WASAPI loopback not available (no VB-Cable) — record mic only.
      this.systemSource = null
    }

    // Mic stream (naudiodon, mono float).
    const portAudio = await import('naudiodon2')
    this.micIo = new portAudio.AudioIO({
      inOptions: {
        channelCount: MIC_CHANNELS,
        sampleFormat: portAudio.SampleFormatFloat32,
        sampleRate: SAMPLE_RATE,
        deviceId: opts.micId,
        closeOnError: true
      }
    })
    this.micIo.on('data', (buf: Buffer) => {
      const frame = pcmFloat32(buf) // fresh copy — safe to gain in place
      this.micLevel = gainAndPeakInPlace(frame, this.gains.mic)
      this.accumulator.pushMic(frame)
    })
    this.micIo.on('error', (err: Error) =>
      this.emitStatus('error', `Mic error: ${err.message}`)
    )
    this.micIo.start()

    this.recording = true
    this.levelsTimer = setInterval(() => {
      this.emit('levels', { mic: this.micLevel, system: this.systemLevel } satisfies Levels)
    }, LEVELS_INTERVAL_MS)
    this.flushTimer = setInterval(() => this.flushChunk(), opts.intervalSec * 1000)

    this.emitStatus('recording', '🔴 Recording...')
    return this.sessionDir
  }

  /** Encode + write the buffered audio as the next chunk, then clear buffers. */
  private flushChunk(): void {
    if (!this.sessionDir || !this.accumulator.hasData()) return
    const { mic, system, systemChannels } = this.accumulator.flush()
    const encoded = encodeChunk({ mic, system, systemChannels, sampleRate: SAMPLE_RATE })
    if (!encoded.wav) return
    this.chunkNumber += 1
    const name = `chunk_${String(this.chunkNumber).padStart(3, '0')}.wav`
    writeFileSync(join(this.sessionDir, name), Buffer.from(encoded.wav))
    this.emitStatus('recording', `🔴 Recording... (saved chunk ${this.chunkNumber})`)
  }

  async stop(): Promise<{ sessionDir: string; chunkCount: number }> {
    if (!this.recording) throw new Error('Not recording')
    this.recording = false
    if (this.levelsTimer) clearInterval(this.levelsTimer)
    if (this.flushTimer) clearInterval(this.flushTimer)
    this.levelsTimer = null
    this.flushTimer = null

    this.emitStatus('saving', '💾 Saving final chunk...')

    // Stop streams first so no more frames arrive, then flush the remainder.
    if (this.micIo) {
      await new Promise<void>((resolve) => this.micIo.quit(resolve))
      this.micIo = null
    }
    if (this.systemSource) {
      await this.systemSource.stop()
      this.systemSource = null
    }

    this.flushChunk() // final partial chunk (Python writes a final chunk on stop)

    const sessionDir = this.sessionDir as string
    const chunkCount = this.chunkNumber
    this.emitStatus('idle', `✅ Saved ${chunkCount} chunks`)
    return { sessionDir, chunkCount }
  }

  private emitStatus(phase: RecorderStatus['phase'], message: string): void {
    this.emit('status', {
      phase,
      message,
      chunkCount: this.chunkNumber,
      sessionDir: this.sessionDir
    } satisfies RecorderStatus)
  }
}
