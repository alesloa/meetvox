import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { TranscribeEvent, TranscribeMode, TranscribePhase } from '@shared/types'
import { useMeetings } from './meetings'
import { ipcErrorText } from '../lib/ipcError'

const RUNNING: TranscribePhase[] = ['needs-model', 'downloading-model', 'running']

interface TranscriptionValue {
  /** The running transcription (any meeting), or null. */
  job: TranscribeEvent | null
  /** How the last transcription ended: done, stopped, or error. */
  ended: TranscribeEvent | null
  start: (meetingDir: string, mode: TranscribeMode) => Promise<void>
  stop: () => void
}

const TranscriptionContext = createContext<TranscriptionValue | null>(null)

/**
 * The one transcription main runs, shared by Home, meeting pages and Import, so a
 * page opened mid-run shows the same job and every page can stop it.
 */
export function TranscriptionProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const { refresh } = useMeetings()
  const [job, setJob] = useState<TranscribeEvent | null>(null)
  const [ended, setEnded] = useState<TranscribeEvent | null>(null)

  useEffect(() => {
    void window.meetvox.getTranscriptionStatus().then(setJob)
    return window.meetvox.onTranscribeProgress((e) => {
      if (RUNNING.includes(e.phase)) {
        setJob(e)
        return
      }
      setJob(null)
      setEnded(e)
      // The library shows hasTranscript / "stopped at N of M" — reload it.
      void refresh()
    })
  }, [refresh])

  const start = useCallback(async (meetingDir: string, mode: TranscribeMode) => {
    setEnded(null)
    try {
      await window.meetvox.transcribe(meetingDir, mode)
    } catch (e) {
      // Refusals before a job starts (busy, still recording) send no event; show them here.
      setEnded({ meetingDir, phase: 'error', message: ipcErrorText(e), chunkIndex: 0, chunkCount: 0 })
    }
  }, [])

  const stop = useCallback(() => {
    void window.meetvox.stopTranscription()
  }, [])

  return (
    <TranscriptionContext.Provider value={{ job, ended, start, stop }}>
      {children}
    </TranscriptionContext.Provider>
  )
}

export function useTranscription(): TranscriptionValue {
  const ctx = useContext(TranscriptionContext)
  if (!ctx) throw new Error('useTranscription must be used within TranscriptionProvider')
  return ctx
}
