import { useCallback, useEffect, useRef, useState } from 'react'
import { Sparkles, RefreshCw, Copy, Check, Loader2 } from 'lucide-react'
import type { ProviderConfig, Summary } from '@shared/types'
import { useSettings } from '../app/settings'
import { fmtDate } from '../lib/format'
import { Markdown } from '../lib/markdown'

interface SummaryPaneProps {
  meetingDir: string
}

/**
 * Pick the active summary provider the same way the backend does: the default
 * provider if it's enabled, else the first enabled provider, else none.
 * Reimplemented here (3-line lookup) rather than importing main-process code.
 */
function activeProvider(
  providers: ProviderConfig[],
  defaultProviderId: string | null
): ProviderConfig | null {
  const byDefault = providers.find((p) => p.id === defaultProviderId && p.enabled)
  if (byDefault) return byDefault
  return providers.find((p) => p.enabled) ?? null
}

/**
 * Right-pane AI summary for a meeting.
 *
 * PRIVACY: generating a summary sends the meeting transcript to a cloud
 * provider — it leaves the device. This is the one break from Meetvox's
 * local-only posture, so a persistent note is shown whenever a provider is
 * active. The summary text itself comes ONLY from the get/generate IPC; there
 * is no fabricated content.
 */
export function SummaryPane({ meetingDir }: SummaryPaneProps): JSX.Element {
  const { settings } = useSettings()

  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Guards setState after unmount / meeting switch (generate is long-running).
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Tracks the currently-shown meeting so an in-flight generate for a previous
  // meeting can't write its result into the new meeting's pane after a switch.
  const activeDirRef = useRef(meetingDir)
  useEffect(() => {
    activeDirRef.current = meetingDir
  }, [meetingDir])

  // Transient "Copied" reset timer.
  const copyTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(copyTimer.current), [])

  const provider = settings
    ? activeProvider(settings.summary.providers, settings.summary.defaultProviderId)
    : null

  // --- load any cached summary whenever the meeting changes ---
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSummary(null)
    setCopied(false)

    window.meetvox
      .getSummary(meetingDir)
      .then((res) => {
        if (cancelled) return
        setSummary(res)
        setLoading(false)
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [meetingDir])

  const onGenerate = useCallback(async () => {
    const thisDir = meetingDir
    setGenerating(true)
    setError(null)
    try {
      const res = await window.meetvox.generateSummary(meetingDir)
      // Drop the result if the user switched meetings while it ran.
      if (!mountedRef.current || activeDirRef.current !== thisDir) return
      setSummary(res)
    } catch (e) {
      if (!mountedRef.current || activeDirRef.current !== thisDir) return
      // Backend message is user-facing (no-provider / missing-key / CLI-not-
      // logged-in / API error). Surface it softly.
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (mountedRef.current && activeDirRef.current === thisDir) setGenerating(false)
    }
  }, [meetingDir])

  const onCopy = useCallback(async () => {
    if (!summary) return
    try {
      await navigator.clipboard.writeText(summary.text)
      setCopied(true)
      clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => {
        if (mountedRef.current) setCopied(false)
      }, 1500)
    } catch {
      // Clipboard denied — nothing actionable to show in this small pane.
    }
  }, [summary])

  const privacyNote = provider ? (
    <p className="px-4 py-2 text-[11px] leading-snug text-muted-foreground">
      Generating sends this transcript to {provider.label} — it leaves your device.
    </p>
  ) : null

  if (loading) {
    return (
      <div className="flex h-full w-80 shrink-0 items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading summary…</span>
      </div>
    )
  }

  // --- has a cached/generated summary ---
  if (summary) {
    return (
      <div className="flex h-full w-80 shrink-0 flex-col">
        <div className="flex shrink-0 items-start justify-between gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              Summary
            </div>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {fmtDate(summary.generatedAt)} · {summary.provider}
              {summary.model ? ` · ${summary.model}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              title="Copy summary"
              onClick={onCopy}
              className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
            <button
              type="button"
              title="Regenerate summary"
              onClick={onGenerate}
              disabled={generating}
              className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              {generating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <Markdown text={summary.text} />
        </div>

        {error && <p className="px-4 pt-1 text-xs text-destructive">{error}</p>}
        {privacyNote}
      </div>
    )
  }

  // --- no summary yet ---
  return (
    <div className="flex h-full w-80 shrink-0 flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <Sparkles className="h-6 w-6 text-muted-foreground" />
        {provider ? (
          <>
            <div>
              <p className="text-sm font-medium text-foreground">No summary yet</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Generate an AI summary of this meeting.
              </p>
            </div>
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" /> Generate with {provider.label}
                </>
              )}
            </button>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </>
        ) : (
          <p className="max-w-[16rem] text-xs text-muted-foreground">
            No AI summary provider is enabled — enable one in Settings → AI Summary.
          </p>
        )}
      </div>
      {privacyNote}
    </div>
  )
}
