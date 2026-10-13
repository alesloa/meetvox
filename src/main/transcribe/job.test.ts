import { describe, it, expect } from 'vitest'
import { createJobSlot, untilStopped, BUSY_MESSAGE } from './job'
import type { TranscribeEvent } from '@shared/types'

function slotWithEvents(): { slot: ReturnType<typeof createJobSlot>; events: TranscribeEvent[] } {
  const events: TranscribeEvent[] = []
  return { slot: createJobSlot((e) => events.push(e)), events }
}

const running = { phase: 'running', message: 'Processing chunk 2/5', chunkIndex: 2, chunkCount: 5 } as const

describe('createJobSlot — one transcription at a time, stoppable', () => {
  it('passes the result through, and nothing runs afterwards', async () => {
    const { slot } = slotWithEvents()
    expect(await slot.run('/m/a', async () => 'result')).toBe('result')
    expect(slot.current()).toBeNull()
  })

  it('tags every progress event with the meeting folder', async () => {
    const { slot, events } = slotWithEvents()
    await slot.run('/m/a', async ({ progress }) => progress(running))
    expect(events.length).toBeGreaterThan(0)
    expect(events.every((e) => e.meetingDir === '/m/a')).toBe(true)
    expect(events.at(-1)).toMatchObject(running)
  })

  it('current() shows the running job and its latest progress', async () => {
    const { slot } = slotWithEvents()
    let release = (): void => {}
    const job = slot.run('/m/a', ({ progress }) => {
      progress(running)
      return new Promise<void>((r) => (release = r))
    })
    expect(slot.current()).toMatchObject({ meetingDir: '/m/a', ...running })
    release()
    await job
  })

  it('refuses a second job while one runs', async () => {
    const { slot } = slotWithEvents()
    let release = (): void => {}
    const first = slot.run('/m/a', () => new Promise<void>((r) => (release = r)))
    await expect(slot.run('/m/b', async () => 'x')).rejects.toThrow(BUSY_MESSAGE)
    release()
    await first
  })

  it('stop aborts the work, resolves "stopped", and says so', async () => {
    const { slot, events } = slotWithEvents()
    const job = slot.run(
      '/m/a',
      ({ signal }) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason))
        })
    )
    slot.stop()
    expect(await job).toBe('stopped')
    expect(events.at(-1)).toMatchObject({ meetingDir: '/m/a', phase: 'stopped' })
    expect(slot.current()).toBeNull()
  })

  it('a failure ends the job with an error event and rejects', async () => {
    const { slot, events } = slotWithEvents()
    await expect(
      slot.run('/m/a', async () => {
        throw new Error('model missing')
      })
    ).rejects.toThrow('model missing')
    expect(events.at(-1)).toMatchObject({ meetingDir: '/m/a', phase: 'error', message: 'model missing' })
    expect(slot.current()).toBeNull()
  })

  it('stop with nothing running does nothing', () => {
    const { slot, events } = slotWithEvents()
    slot.stop()
    expect(events).toEqual([])
  })
})

describe('untilStopped — a step that ignores the stop still ends the job', () => {
  it('rejects as soon as the signal aborts, without waiting for the step', async () => {
    const stop = new AbortController()
    const never = new Promise<string>(() => {}) // e.g. a model download still running
    const waiting = untilStopped(never, stop.signal)
    stop.abort()
    await expect(waiting).rejects.toThrow()
  })

  it('passes the result through when there is no stop', async () => {
    expect(await untilStopped(Promise.resolve('engine'), new AbortController().signal)).toBe('engine')
  })
})
