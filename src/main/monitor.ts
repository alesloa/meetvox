// Monitor — pre-record live VU. Mirrors the Recorder's mic-open path (naudiodon
// mono float32 @ 44.1 kHz) but writes NOTHING: no accumulator, no WAV, no files.
// Its only job is to emit `{ mic, system }` levels so the Home-screen VU meters
// move before recording starts. The mic can only be opened once on a machine, so
// the Monitor releases the mic on stop() and the record handoff stops it before
// the Recorder opens the same device. Levels reuse the same Events.levels channel
// as the Recorder — they are never active simultaneously.

import { EventEmitter } from 'events'
import { SAMPLE_RATE, MIC_CHANNELS, LEVELS_INTERVAL_MS, GAIN_DEFAULT } from '@shared/constants'
import { gainAndPeakInPlace } from './audio/levels'
import { pcmFloat32 } from './audio/pcm'
import type { SystemSource } from './audio/systemSource'
import type { Gains, Levels } from '@shared/types'

export interface MonitorStartOptions {
  micId: number
  gains: Gains
  /** Present only when includeSystem — spawns syscap (triggers screen-rec prompt). */
  systemSource?: SystemSource
}

export interface MonitorEvents {
  levels: (levels: Levels) => void
  error: (err: Error) => void
}

export class Monitor extends EventEmitter {
  private gains: Gains = { mic: GAIN_DEFAULT, system: GAIN_DEFAULT }
  private micLevel = 0
  private systemLevel = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private micIo: any = null
  private systemSource: SystemSource | null = null
  private levelsTimer: NodeJS.Timeout | null = null
  private monitoring = false
  // Serializes start/stop so a stop() in flight always finishes before the next
  // start() opens a device. The renderer fires stopMonitor (effect cleanup) +
  // startMonitor (effect body) back-to-back on a mic change without awaiting the
  // stop; without this chain, start() reassigns this.micIo mid-stop() and stop()'s
  // async quit() callback then nulls the NEW stream's reference — orphaning the
  // naudiodon stream. The orphan keeps emitting levels, so the selected mic never
  // actually switches and muting it doesn't zero the meter.
  private opChain: Promise<void> = Promise.resolve()

  isMonitoring(): boolean {
    return this.monitoring
  }

  setGain(gains: Gains): void {
    this.gains = gains
  }

  start(opts: MonitorStartOptions): Promise<void> {
    return this.enqueue(() => this.doStart(opts))
  }

  stop(): Promise<void> {
    return this.enqueue(() => this.doStop())
  }

  // Run lifecycle ops one at a time. The op runs after the prior one settles
  // (resolved OR rejected — a failed start must not wedge later stops); the
  // caller still sees this op's own outcome, while opChain swallows it so a
  // rejection never propagates down the queue.
  private enqueue(op: () => Promise<void>): Promise<void> {
    const run = this.opChain.then(op, op)
    this.opChain = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private async doStart(opts: MonitorStartOptions): Promise<void> {
    if (this.monitoring) throw new Error('Already monitoring')
    this.gains = opts.gains
    this.micLevel = 0
    this.systemLevel = 0

    // Optional system pre-monitor (off by default — spawning it prompts for
    // screen-recording on macOS). Levels only; the audio is never stored.
    if (opts.systemSource) {
      this.systemSource = opts.systemSource
      try {
        await this.systemSource.start(
          (interleaved) => {
            // systemSource hands us a fresh Float32Array, so gain it in place.
            this.systemLevel = gainAndPeakInPlace(interleaved, this.gains.system)
          },
          (err) => this.emit('error', err)
        )
      } catch (_e) {
        // WASAPI loopback not available (no VB-Cable) — meter mic only, keep going.
        this.systemSource = null
      }
    }

    // Mic stream (naudiodon, mono float) — same options the Recorder uses.
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
      // No accumulator, no file write — level is the only output.
    })
    this.micIo.on('error', (err: Error) => this.emit('error', err))
    this.micIo.start()

    this.monitoring = true
    this.levelsTimer = setInterval(() => {
      this.emit('levels', { mic: this.micLevel, system: this.systemLevel } satisfies Levels)
    }, LEVELS_INTERVAL_MS)
  }

  private async doStop(): Promise<void> {
    if (!this.monitoring) return
    this.monitoring = false

    if (this.levelsTimer) clearInterval(this.levelsTimer)
    this.levelsTimer = null

    // Release the mic FIRST so the device is free for the Recorder.
    if (this.micIo) {
      await new Promise<void>((resolve) => this.micIo.quit(resolve))
      this.micIo = null
    }
    if (this.systemSource) {
      await this.systemSource.stop()
      this.systemSource = null
    }

    this.micLevel = 0
    this.systemLevel = 0
  }
}
