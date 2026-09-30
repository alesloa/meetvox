import { describe, it, expect, afterEach } from 'vitest'
import { spawn, type ChildProcess } from 'child_process'
import { settleWithin, terminateProcess } from './teardown'

describe('settleWithin — teardown that can never hang the caller', () => {
  it('resolves "done" when the work settles before the deadline', async () => {
    expect(await settleWithin(Promise.resolve(), 1000)).toBe('done')
  })

  it('resolves "done" even if the work rejects (teardown errors are non-fatal)', async () => {
    expect(await settleWithin(Promise.reject(new Error('close failed')), 1000)).toBe('done')
  })

  it('resolves "timeout" (never hangs) when the work never settles', async () => {
    // A native quit() callback that never fires: without a deadline this would hang
    // stop() forever. settleWithin must give up and let the caller move on.
    expect(await settleWithin(new Promise<void>(() => {}), 30)).toBe('timeout')
  })
})

describe('terminateProcess — SIGTERM, then SIGKILL so a child can never leak', () => {
  const spawned: ChildProcess[] = []

  afterEach(() => {
    for (const p of spawned) {
      try {
        p.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }
    spawned.length = 0
  })

  /** Spawn a node child and wait until it is actually running its script. */
  async function child(code: string): Promise<ChildProcess> {
    const p = spawn(process.execPath, ['-e', code])
    spawned.push(p)
    await new Promise<void>((resolve) => p.once('spawn', () => resolve()))
    // Give the -e script a moment to install any signal handlers before we signal it.
    await new Promise((r) => setTimeout(r, 60))
    return p
  }

  it('a well-behaved child dies on SIGTERM without waiting out the grace period', async () => {
    const p = await child('setTimeout(() => {}, 60000)') // no handler → default: dies on SIGTERM
    await terminateProcess(p, 2000)
    expect(p.signalCode).toBe('SIGTERM')
  })

  it('a child that ignores SIGTERM is force-killed with SIGKILL after the grace period', async () => {
    const p = await child('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)')
    await terminateProcess(p, 50)
    expect(p.signalCode).toBe('SIGKILL')
  })

  it('resolves immediately if the process is already dead', async () => {
    // Attach the exit listener up front — the child() helper's startup delay would
    // otherwise swallow the exit event of an instantly-exiting process.
    const p = spawn(process.execPath, ['-e', 'process.exit(0)'])
    spawned.push(p)
    await new Promise<void>((resolve) => p.once('exit', () => resolve()))
    await expect(terminateProcess(p, 2000)).resolves.toBeUndefined()
  })
})
