// The one running transcription. Home, a meeting page and Import all start
// transcriptions through this slot, so only one runs at a time and Stop works
// from anywhere. Every progress update is tagged with the meeting folder, and the
// job always ends with a done, stopped or error event the renderer can act on.

import type { TranscribeEvent, TranscribePhase, TranscribeProgress } from '@shared/types'

export const BUSY_MESSAGE = 'Another meeting is transcribing. Stop it first.'

export interface JobControl {
  signal: AbortSignal
  progress: (p: TranscribeProgress) => void
}

export interface JobSlot {
  /** The running job's latest event, or null when nothing runs. */
  current(): TranscribeEvent | null
  /** Resolves with the work's result, or 'stopped' after stop(). Rejects when busy or when the work fails. */
  run<T>(meetingDir: string, work: (job: JobControl) => Promise<T>): Promise<T | 'stopped'>
  stop(): void
}

/**
 * Wait for a step that can't be cancelled (a model download), but give up the
 * moment the job is stopped. The step keeps running on its own.
 */
export function untilStopped<T>(step: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason)
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
    step.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

function event(meetingDir: string, phase: TranscribePhase, message: string): TranscribeEvent {
  return { meetingDir, phase, message, chunkIndex: 0, chunkCount: 0 }
}

export function createJobSlot(emit: (e: TranscribeEvent) => void): JobSlot {
  let running: { controller: AbortController; last: TranscribeEvent } | null = null

  return {
    current: () => running?.last ?? null,

    async run(meetingDir, work) {
      if (running) throw new Error(BUSY_MESSAGE)
      const controller = new AbortController()
      const job = { controller, last: event(meetingDir, 'running', 'Starting…') }
      running = job
      emit(job.last)
      try {
        return await work({
          signal: controller.signal,
          progress: (p) => {
            job.last = { ...p, meetingDir }
            emit(job.last)
          }
        })
      } catch (e) {
        running = null
        if (controller.signal.aborted) {
          emit(event(meetingDir, 'stopped', 'Transcription stopped.'))
          return 'stopped'
        }
        emit(event(meetingDir, 'error', e instanceof Error ? e.message : String(e)))
        throw e
      } finally {
        running = null
      }
    },

    stop: () => running?.controller.abort()
  }
}
