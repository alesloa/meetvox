import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { LEVELS_INTERVAL_MS } from '@shared/constants'
import type { Levels } from '@shared/types'

// First test in the repo to mock naudiodon2. Mirror exactly how recorder.ts /
// monitor.ts read the dynamic import: `portAudio.AudioIO` (constructor) and
// `portAudio.SampleFormatFloat32`. The fake AudioIO captures the 'data' callback
// so the test can push a buffer through it, and resolves quit(cb) synchronously.
let dataCb: ((buf: Buffer) => void) | null = null
const startSpy = vi.fn()
const quitSpy = vi.fn((cb: () => void) => cb())

vi.mock('naudiodon2', () => {
  class AudioIO {
    on(ev: string, cb: (arg: unknown) => void): void {
      if (ev === 'data') dataCb = cb as (buf: Buffer) => void
    }
    start(): void {
      startSpy()
    }
    quit(cb: () => void): void {
      quitSpy(cb)
    }
  }
  return { AudioIO, SampleFormatFloat32: 1 }
})

// Build a non-silent interleaved float32 Buffer (one mono frame of peak 0.5).
function nonSilentBuf(): Buffer {
  const f = Float32Array.from([0.1, -0.5, 0.2, 0.05])
  return Buffer.from(f.buffer.slice(0))
}

describe('Monitor — pre-record mic VU, writes nothing', () => {
  beforeEach(() => {
    dataCb = null
    startSpy.mockClear()
    quitSpy.mockClear()
    vi.resetModules()
    vi.useFakeTimers()
  })

  afterEach(() => {
    // Always restore real timers so a failed assertion can't leak fake timers
    // into the next test.
    vi.useRealTimers()
  })

  it('opens the mic, emits non-zero mic level (system 0), writes no files', async () => {
    const { Monitor } = await import('./monitor')
    const monitor = new Monitor()

    const seen: Levels[] = []
    monitor.on('levels', (l: Levels) => seen.push(l))

    await monitor.start({ micId: 0, gains: { mic: 1, system: 1 } })

    expect(startSpy).toHaveBeenCalledOnce()
    expect(dataCb).toBeTypeOf('function')

    // Push a non-silent mic buffer through the captured naudiodon 'data' callback.
    dataCb!(nonSilentBuf())

    vi.advanceTimersByTime(LEVELS_INTERVAL_MS)

    expect(seen.length).toBeGreaterThan(0)
    const last = seen[seen.length - 1]
    expect(last.mic).toBeGreaterThan(0) // mic moved from the real buffer
    expect(last.system).toBe(0) // no system source -> stays 0 (You/Other invariant)

    await monitor.stop()
    expect(quitSpy).toHaveBeenCalledOnce() // mic released on stop (handoff safety)
  })

  it('throws if already monitoring (mic opens once)', async () => {
    const { Monitor } = await import('./monitor')
    const monitor = new Monitor()
    await monitor.start({ micId: 0, gains: { mic: 1, system: 1 } })
    await expect(monitor.start({ micId: 0, gains: { mic: 1, system: 1 } })).rejects.toThrow()
    await monitor.stop()
  })

  it('stop() is a no-op when not monitoring', async () => {
    const { Monitor } = await import('./monitor')
    const monitor = new Monitor()
    await expect(monitor.stop()).resolves.toBeUndefined()
    expect(monitor.isMonitoring()).toBe(false)
  })
})
