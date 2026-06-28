import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { Settings } from '@shared/types'

interface SettingsValue {
  settings: Settings | null
  secretsSet: Record<string, boolean>
  loading: boolean
  error: string | null
  save: (partial: Partial<Settings>) => Promise<void>
  reloadSecrets: () => Promise<void>
}

const SettingsContext = createContext<SettingsValue | null>(null)

export function SettingsProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [secretsSet, setSecretsSet] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    window.meetvox
      .getSettings()
      .then((res) => {
        if (cancelled) return
        setSettings(res.settings)
        setSecretsSet(res.secretsSet)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const save = useCallback(async (partial: Partial<Settings>) => {
    const merged = await window.meetvox.saveSettings(partial)
    setSettings(merged)
  }, [])

  const reloadSecrets = useCallback(async () => {
    const res = await window.meetvox.getSettings()
    setSecretsSet(res.secretsSet)
  }, [])

  return (
    <SettingsContext.Provider value={{ settings, secretsSet, loading, error, save, reloadSecrets }}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider')
  return ctx
}
