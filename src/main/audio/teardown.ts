// Teardown primitives that guarantee stopping a recording can never hang the UI.
//
// Native audio shutdown (naudiodon's PortAudio quit callback, a syscap child exiting)
// can stall or never call back under load. stop() runs on the main process and blocks
// the IPC/render round-trip, so a stalled teardown freezes the whole window. These
// helpers bound every wait: worst case we give up and move on / force-kill.

import type { ChildProcess } from 'child_process'

/**
 * Deadline for a naudiodon/PortAudio `quit()` callback. Normal close is tens of ms;
 * this is a generous ceiling that keeps a pathological stall from freezing the UI
 * while never firing on a healthy shutdown.
 */
export const QUIT_TIMEOUT_MS = 3000

/**
 * Await `work`, but never longer than `ms`. Resolves 'done' when it settles (a
 * rejection counts as done — teardown errors are non-fatal), or 'timeout' if the
 * deadline hits first. Never rejects, never hangs.
 */
export function settleWithin(work: Promise<unknown>, ms: number): Promise<'done' | 'timeout'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), ms)
    const done = (): void => {
      clearTimeout(timer)
      resolve('done')
    }
    work.then(done, done)
  })
}

/**
 * Terminate a child process without ever hanging. Sends SIGTERM, waits up to
 * `graceMs` for a clean exit, then escalates to SIGKILL. Resolves once the child is
 * gone (or shortly after SIGKILL is sent, so the caller is never stuck).
 */
export function terminateProcess(proc: ChildProcess, graceMs = 1500): Promise<void> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null || proc.signalCode !== null) return resolve() // already dead

    let settled = false
    let graceTimer: NodeJS.Timeout
    let hardTimer: NodeJS.Timeout
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(graceTimer)
      clearTimeout(hardTimer)
      resolve()
    }

    proc.once('exit', finish)

    try {
      proc.kill('SIGTERM')
    } catch {
      return finish() // race: it exited between the check and here
    }

    // Ignored SIGTERM → force-kill after the grace period.
    graceTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }, graceMs)

    // Absolute backstop: resolve even if the 'exit' event never arrives.
    hardTimer = setTimeout(finish, graceMs + 500)
  })
}
