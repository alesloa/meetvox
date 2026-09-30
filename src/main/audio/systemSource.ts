// Platform-abstracted system-audio source. Every variant presents the same interface
// to the recorder: a 2-channel float32 PCM stream at 44.1 kHz.
//
//   Mac (BlackHole): open the selected loopback INPUT device via naudiodon — the same
//         PortAudio-input capture recorder_blackhole.py uses (sd.InputStream on
//         BlackHole 2ch). No permission prompt; requires the BlackHole + Multi-Output
//         routing. This is the default when a loopback device is present.
//   Mac (ScreenCaptureKit): spawn the bundled `meetvox-syscap`, read interleaved
//         float32 stereo from stdout. Whole-mix fallback when no loopback device is
//         selected; costs a one-time screen-recording permission prompt.
//   Win:  open a WASAPI loopback input via naudiodon on the chosen render endpoint.

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { SAMPLE_RATE, SYSTEM_CHANNELS, MAC_SYSTEM_AUDIO_ID } from '@shared/constants'
import { pcmFloat32 } from './pcm'
import { settleWithin, terminateProcess, QUIT_TIMEOUT_MS } from './teardown'
import type { Platform } from '@shared/types'

export type FrameHandler = (interleaved: Float32Array) => void

/** 'device' = a real PortAudio input (BlackHole loopback / WASAPI endpoint);
 *  'screencapture' = the macOS ScreenCaptureKit whole-mix helper. */
export type SystemSourceKind = 'device' | 'screencapture'

export interface SystemSource {
  readonly kind: SystemSourceKind
  readonly channels: number
  start(onFrame: FrameHandler, onError: (err: Error) => void): Promise<void>
  stop(): Promise<void>
}

/** macOS: ScreenCaptureKit helper process emitting float32 stereo PCM on stdout. */
class MacSystemSource implements SystemSource {
  readonly kind = 'screencapture'
  readonly channels = SYSTEM_CHANNELS
  private proc: ChildProcessWithoutNullStreams | null = null

  constructor(private readonly helperPath: string) {}

  async start(onFrame: FrameHandler, onError: (err: Error) => void): Promise<void> {
    const proc = spawn(this.helperPath, [
      '--sample-rate',
      String(SAMPLE_RATE),
      '--channels',
      String(SYSTEM_CHANNELS)
    ])
    this.proc = proc

    proc.stdout.on('data', (buf: Buffer) => onFrame(pcmFloat32(buf)))
    proc.on('error', onError)
    proc.stderr.on('data', (d: Buffer) => {
      const msg = d.toString().trim()
      // The helper prints permission/diagnostic lines here; surface real failures.
      if (/permission|denied|error/i.test(msg)) onError(new Error(`syscap: ${msg}`))
    })
    proc.on('close', (code) => {
      if (code && code !== 0 && this.proc) onError(new Error(`syscap exited ${code}`))
    })
  }

  async stop(): Promise<void> {
    const proc = this.proc
    this.proc = null
    if (proc) {
      proc.stdout.removeAllListeners()
      // SIGTERM, then SIGKILL if the helper is wedged in CoreAudio teardown — a bare
      // SIGTERM that the process ignores would leak the syscap child and hold the tap.
      await terminateProcess(proc)
    }
  }
}

/**
 * PortAudio input capture of a single device via naudiodon — used for a Windows WASAPI
 * render endpoint AND a macOS loopback input (BlackHole). Identical mechanism to
 * recorder_blackhole.py's sd.InputStream(device=..., channels=2): open the device id
 * at 2ch float32 / 44.1 kHz and forward each interleaved buffer.
 */
class PortAudioInputSource implements SystemSource {
  readonly kind = 'device'
  readonly channels = SYSTEM_CHANNELS
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private io: any = null

  constructor(private readonly deviceId: number) {}

  async start(onFrame: FrameHandler, onError: (err: Error) => void): Promise<void> {
    const portAudio = await import('naudiodon2')
    this.io = new portAudio.AudioIO({
      inOptions: {
        channelCount: SYSTEM_CHANNELS,
        sampleFormat: portAudio.SampleFormatFloat32,
        sampleRate: SAMPLE_RATE,
        deviceId: this.deviceId,
        closeOnError: true
      }
    })
    this.io.on('data', (buf: Buffer) => onFrame(pcmFloat32(buf)))
    this.io.on('error', onError)
    this.io.start()
  }

  async stop(): Promise<void> {
    const io = this.io
    this.io = null
    // Bound the PortAudio quit: its callback can stall indefinitely under load, and
    // stop() runs on the main process — an unbounded wait freezes the window.
    if (io) await settleWithin(new Promise<void>((resolve) => io.quit(resolve)), QUIT_TIMEOUT_MS)
  }
}

export function createSystemSource(
  platform: Platform,
  opts: { syscapPath?: string; deviceId?: number }
): SystemSource {
  if (platform === 'mac') {
    // A real loopback id (BlackHole) → PortAudio input capture; the synthetic id (-1)
    // or no id → the ScreenCaptureKit whole-mix helper.
    const isLoopbackDevice = opts.deviceId !== undefined && opts.deviceId !== MAC_SYSTEM_AUDIO_ID
    if (isLoopbackDevice) return new PortAudioInputSource(opts.deviceId as number)
    if (!opts.syscapPath) throw new Error('meetvox-syscap path required on macOS')
    return new MacSystemSource(opts.syscapPath)
  }
  if (opts.deviceId === undefined) throw new Error('WASAPI render endpoint id required on Windows')
  return new PortAudioInputSource(opts.deviceId)
}
