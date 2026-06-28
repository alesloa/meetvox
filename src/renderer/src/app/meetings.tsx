import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { Meeting } from '@shared/types'

interface MeetingsValue {
  meetings: Meeting[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

const MeetingsContext = createContext<MeetingsValue | null>(null)

export function MeetingsProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await window.meetvox.listMeetings()
      setMeetings(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <MeetingsContext.Provider value={{ meetings, loading, error, refresh }}>
      {children}
    </MeetingsContext.Provider>
  )
}

export function useMeetings(): MeetingsValue {
  const ctx = useContext(MeetingsContext)
  if (!ctx) throw new Error('useMeetings must be used within MeetingsProvider')
  return ctx
}
