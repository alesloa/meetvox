import type { Meeting, TranscribeEvent } from '@shared/types'

/** What the transcribe controls for one meeting show. */
export type ControlsState =
  | { kind: 'running'; job: TranscribeEvent } // this meeting is transcribing: Stop
  | { kind: 'busy'; job: TranscribeEvent } // another meeting is transcribing
  | { kind: 'stopped'; done: number; total: number } // Continue / Start over
  | { kind: 'idle'; hasTranscript: boolean } // Transcribe / Transcribe again

export function controlsState(input: {
  job: TranscribeEvent | null
  meetingDir: string
  progress: Meeting['progress']
  hasTranscript: boolean
}): ControlsState {
  const { job, meetingDir, progress, hasTranscript } = input
  if (job) return { kind: job.meetingDir === meetingDir ? 'running' : 'busy', job }
  if (progress) return { kind: 'stopped', ...progress }
  return { kind: 'idle', hasTranscript }
}
