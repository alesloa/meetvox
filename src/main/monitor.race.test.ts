import { describe, it, expect, vi, beforeEach } from 'vitest'

// Faithful-to-hardware naudiodon mock: quit(cb) is ASYNC — real PortAudio closes
// the stream on a later tick, not synchronously like monitor.test.ts fakes it.
// That async close is exactly what opens the stop()/start() race window. Each
// AudioIO records the deviceId it opened and whether it was ever quit, so the
// test can detect an orphaned stream that keeps feeding the meter after a mic
// change.
interface FakeIO {
  deviceId: number
  quit: boolean
}
let instances: FakeIO[] = []

vi.mock('naudiodon2', () => {
  class AudioIO {
    private rec: FakeIO
    constructor(options: { inOptions: { deviceId: number } }) {
      this.rec = { deviceId: options.inOptions.deviceId, quit: false }
      instances.push(this.rec)
    }
    on(): void {}
    start(): void {}
    quit(cb?: () => void): void {
      setTimeout(() => {
        this.rec.quit = true
        cb?.()
      }, 0)
    }
  }
  return { AudioIO, SampleFormatFloat32: 1 }
})

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

describe('Monitor — mic selection must switch cleanly (no orphaned streams)', () => {
  beforeEach(() => {
    instances = []
    vi.resetModules()
  })

  it('closes every opened stream when the selection changes rapidly', async () => {
    const { Monitor } = await import('./monitor')
    const m = new Monitor()
    const gains = { mic: 1, system: 1 }

    await m.start({ micId: 1, gains })
    // The renderer fires stopMonitor (effect cleanup) then startMonitor (effect
    // body) WITHOUT awaiting the stop — the exact sequence a mic-dropdown change
    // produces. Two rapid changes, the way a user clicking through mics does it.
    await Promise.all([m.stop(), m.start({ micId: 2, gains })])
    await Promise.all([m.stop(), m.start({ micId: 3, gains })])
    await m.stop()
    await flush() // let any deferred quit callbacks run

    // Three devices were opened, in selection order.
    expect(instances.map((i) => i.deviceId)).toEqual([1, 2, 3])
    // None may still be open. A surviving stream keeps emitting levels, so the
    // newly selected mic never takes over and muting it won't zero the meter.
    expect(instances.filter((i) => !i.quit)).toEqual([])
  })
})
