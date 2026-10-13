import { describe, it, expect } from 'vitest'
import { controlsState } from './transcribeControls'
import type { TranscribeEvent } from '@shared/types'

const job = (meetingDir: string): TranscribeEvent => ({
  meetingDir,
  phase: 'running',
  message: 'Processing chunk 3/9',
  chunkIndex: 3,
  chunkCount: 9
})

const base = { meetingDir: '/m/a', progress: null, hasTranscript: false }

describe('controlsState — what the transcribe controls show for one meeting', () => {
  it('shows Stop while this meeting transcribes', () => {
    expect(controlsState({ ...base, job: job('/m/a') })).toEqual({ kind: 'running', job: job('/m/a') })
  })

  it('is busy while another meeting transcribes, even with saved progress', () => {
    const state = controlsState({ ...base, job: job('/m/b'), progress: { done: 2, total: 9 } })
    expect(state).toEqual({ kind: 'busy', job: job('/m/b') })
  })

  it('offers continue or start over when a stopped run saved pieces', () => {
    expect(controlsState({ ...base, job: null, progress: { done: 2, total: 9 } })).toEqual({
      kind: 'stopped',
      done: 2,
      total: 9
    })
  })

  it('offers Transcribe, or Transcribe again when a transcript exists', () => {
    expect(controlsState({ ...base, job: null })).toEqual({ kind: 'idle', hasTranscript: false })
    expect(controlsState({ ...base, job: null, hasTranscript: true })).toEqual({
      kind: 'idle',
      hasTranscript: true
    })
  })
})
