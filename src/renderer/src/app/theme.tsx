import React, { createContext, useContext, useEffect, useState } from 'react'

export type ThemePref = 'light' | 'dark' | 'system'
export type AppliedTheme = 'light' | 'dark'

/** Pure resolver — no side-effects. */
export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): AppliedTheme {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light'
  return pref
}

interface ThemeContextValue {
  pref: ThemePref
  applied: AppliedTheme
  setPref: (pref: ThemePref) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const mql =
    typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

  const [pref, setPref] = useState<ThemePref>('system')
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(mql?.matches ?? false)

  // Sync OS dark-mode changes.
  useEffect(() => {
    if (!mql) return
    const handler = (e: MediaQueryListEvent): void => setSystemPrefersDark(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const applied = resolveTheme(pref, systemPrefersDark)

  // Apply .dark class to <html> whenever resolved theme changes.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', applied === 'dark')
  }, [applied])

  return <ThemeContext.Provider value={{ pref, applied, setPref }}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
