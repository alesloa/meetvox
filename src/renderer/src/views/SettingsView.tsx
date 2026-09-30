import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Settings as SettingsIcon,
  Sliders,
  FileText,
  Sparkles,
  Info,
  Sun,
  Moon,
  Monitor,
  Mic,
  Volume2,
  Loader2,
  AlertCircle,
  FolderOpen,
  RotateCcw
} from 'lucide-react'
import { Select } from '../components/Select'
import { AiProviderCard } from '../components/AiProviderCard'
import { Field, SectionTitle } from '../components/SettingsField'
import { TranscriptionPanel } from '../components/TranscriptionPanel'
import { useSettings } from '../app/settings'
import { useTheme } from '../app/theme'
import type { ThemePref } from '../app/theme'
import { GAIN_MAX, GAIN_MIN, GAIN_STEP } from '@shared/constants'
import type { DeviceList, Gains, ProviderConfig, RecordingsDir, Settings } from '@shared/types'

type TabId = 'general' | 'devices' | 'transcription' | 'summary' | 'about'

const TABS: { id: TabId; label: string; icon: JSX.Element }[] = [
  { id: 'general', label: 'General', icon: <SettingsIcon className="h-4 w-4" /> },
  { id: 'devices', label: 'Devices', icon: <Sliders className="h-4 w-4" /> },
  { id: 'transcription', label: 'Transcription', icon: <FileText className="h-4 w-4" /> },
  { id: 'summary', label: 'AI Summary', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'about', label: 'About', icon: <Info className="h-4 w-4" /> }
]

const EMPTY_DEVICES: DeviceList = { mics: [], systems: [], autoMicId: null, autoSystemId: null }

export function SettingsView(): JSX.Element {
  const { settings, loading, error, save } = useSettings()
  const [tab, setTab] = useState<TabId>('general')
  const [saveError, setSaveError] = useState<string | null>(null)

  // Soft-wrap a save so a rejection (e.g. disk error) never crashes the page.
  // Stable (save is useCallback([])) so panels don't re-render on every keystroke.
  const commit = useCallback(
    async (partial: Partial<Settings>): Promise<void> => {
      setSaveError(null)
      try {
        await save(partial)
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e))
      }
    },
    [save]
  )

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        Loading settings…
      </div>
    )
  }

  if (error || !settings) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <AlertCircle className="h-6 w-6 text-destructive" />
        <p className="text-sm font-medium text-foreground">Could not load settings</p>
        <p className="text-xs text-muted-foreground">{error ?? 'Settings unavailable.'}</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="titlebar flex h-11 shrink-0 items-center px-5">
        <h1 className="text-sm font-semibold text-foreground">Settings</h1>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Tab bar */}
        <nav className="flex w-44 shrink-0 flex-col gap-1 border-r border-border p-2">
          {TABS.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`no-drag flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                }`}
              >
                <span className="shrink-0">{t.icon}</span>
                {t.label}
              </button>
            )
          })}
        </nav>

        {/* Panel */}
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {saveError && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>Could not save: {saveError}</span>
            </div>
          )}

          {tab === 'general' && <GeneralPanel settings={settings} commit={commit} />}
          {tab === 'devices' && <DevicesPanel settings={settings} commit={commit} />}
          {tab === 'transcription' && <TranscriptionPanel settings={settings} commit={commit} />}
          {tab === 'summary' && <SummaryPanel />}
          {tab === 'about' && <AboutPanel />}
        </div>
      </div>
    </div>
  )
}

// ── General ─────────────────────────────────────────────────────────────────

const THEME_OPTIONS: { value: ThemePref; label: string; icon: JSX.Element }[] = [
  { value: 'light', label: 'Light', icon: <Sun className="h-3.5 w-3.5" /> },
  { value: 'dark', label: 'Dark', icon: <Moon className="h-3.5 w-3.5" /> },
  { value: 'system', label: 'System', icon: <Monitor className="h-3.5 w-3.5" /> }
]

function GeneralPanel({
  settings,
  commit
}: {
  settings: Settings
  commit: (p: Partial<Settings>) => Promise<void>
}): JSX.Element {
  const { setPref } = useTheme()

  const onTheme = (value: ThemePref): void => {
    setPref(value)
    void commit({ theme: value })
  }

  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-2">
        <SectionTitle>Appearance</SectionTitle>
        <Field label="Theme" hint="System follows your macOS light/dark setting.">
          <div className="inline-flex rounded-lg border border-border bg-card p-1">
            {THEME_OPTIONS.map((o) => {
              const active = settings.theme === o.value
              return (
                <button
                  key={o.value}
                  onClick={() => onTheme(o.value)}
                  className={`no-drag flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {o.icon}
                  {o.label}
                </button>
              )
            })}
          </div>
        </Field>
      </div>

      <div className="space-y-2">
        <SectionTitle>Recordings Folder</SectionTitle>
        <RecordingsFolderSection />
      </div>

      <div className="space-y-2">
        <SectionTitle>Sidebar</SectionTitle>
        <label className="flex items-center justify-between gap-4">
          <span className="text-[13px] text-foreground">Collapse sidebar by default</span>
          <Toggle
            checked={settings.sidebarCollapsed}
            onChange={(v) => void commit({ sidebarCollapsed: v })}
          />
        </label>
      </div>
    </div>
  )
}

// Where recordings + transcripts are saved. Self-contained: reads the live folder
// from main, drives the native picker, and switches it without a restart. Existing
// meetings are left where they were — only new recordings follow the change.
function RecordingsFolderSection(): JSX.Element {
  const [info, setInfo] = useState<RecordingsDir | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.meetvox.getRecordingsDir().then((r) => {
      if (!cancelled) setInfo(r)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const choose = useCallback(async () => {
    setBusy(true)
    try {
      const r = await window.meetvox.chooseRecordingsDir()
      if (r) setInfo(r) // null = user canceled the picker — keep the current folder
    } finally {
      setBusy(false)
    }
  }, [])

  const reset = useCallback(async () => {
    setBusy(true)
    try {
      setInfo(await window.meetvox.resetRecordingsDir())
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <Field
      label="Save location"
      hint="Recordings and transcripts are saved here. Changing it affects new recordings only — existing meetings stay where they are."
    >
      <div className="flex items-center gap-2 rounded-md border border-border bg-input px-3 py-2">
        <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={info?.dir}>
          {info ? info.dir : 'Loading…'}
        </span>
        {info?.isDefault && (
          <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Default
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => void choose()}
          disabled={busy}
          className="no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground transition hover:bg-accent disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
          Choose…
        </button>
        <button
          onClick={() => void window.meetvox.openRecordingsDir()}
          disabled={!info}
          className="no-drag rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-accent disabled:opacity-50"
        >
          Reveal
        </button>
        {info && !info.isDefault && (
          <button
            onClick={() => void reset()}
            disabled={busy}
            className="no-drag flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset to default
          </button>
        )}
      </div>
    </Field>
  )
}

// ── Devices ─────────────────────────────────────────────────────────────────

function DevicesPanel({
  settings,
  commit
}: {
  settings: Settings
  commit: (p: Partial<Settings>) => Promise<void>
}): JSX.Element {
  const [devices, setDevices] = useState<DeviceList>(EMPTY_DEVICES)
  // Local mirror for live slider drag; committed on pointer-up.
  const [gains, setGains] = useState<Gains>(settings.gains)
  const [intervalSec, setIntervalSec] = useState(settings.intervalSec)

  // Latest gains, so the pointer-up commit can't close over a one-render-stale value.
  const gainsRef = useRef(gains)
  useEffect(() => {
    gainsRef.current = gains
  }, [gains])

  useEffect(() => {
    let cancelled = false
    window.meetvox.listDevices().then((d) => {
      if (!cancelled) setDevices(d)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Keep local mirrors in sync if settings change elsewhere.
  useEffect(() => {
    setGains(settings.gains)
    setIntervalSec(settings.intervalSec)
  }, [settings.gains, settings.intervalSec])

  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-3">
        <SectionTitle>Default Devices</SectionTitle>
        <Select
          label="Microphone"
          devices={devices.mics}
          value={settings.defaultMicId}
          onChange={(id) => void commit({ defaultMicId: id })}
        />
        <Select
          label="System Audio"
          devices={devices.systems}
          value={settings.defaultSystemId}
          onChange={(id) => void commit({ defaultSystemId: id })}
        />
      </div>

      <div className="space-y-3">
        <SectionTitle>Default Gain</SectionTitle>
        <GainRow
          icon={<Mic className="h-3.5 w-3.5" />}
          label="Mic"
          value={gains.mic}
          onChange={(v) => setGains((g) => ({ ...g, mic: v }))}
          onCommit={() => void commit({ gains: gainsRef.current })}
        />
        <GainRow
          icon={<Volume2 className="h-3.5 w-3.5" />}
          label="System"
          value={gains.system}
          onChange={(v) => setGains((g) => ({ ...g, system: v }))}
          onCommit={() => void commit({ gains: gainsRef.current })}
        />
      </div>

      <div className="space-y-3">
        <SectionTitle>Recording</SectionTitle>
        <Field label="Auto-save interval" hint="Seconds between chunk writes while recording.">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={intervalSec}
              onChange={(e) =>
                setIntervalSec(Math.max(1, parseInt(e.target.value || '1', 10) || 1))
              }
              onBlur={() => void commit({ intervalSec })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              }}
              className="w-20 rounded-md border border-border bg-input px-2 py-1.5 text-center font-mono text-sm text-foreground outline-none focus:border-ring"
            />
            <span className="text-xs text-muted-foreground">seconds</span>
          </div>
        </Field>

        <label className="flex items-start justify-between gap-4 pt-1">
          <span className="flex flex-col gap-0.5">
            <span className="text-[13px] text-foreground">Pre-monitor system audio</span>
            <span className="text-xs text-muted-foreground">
              Enabling this triggers the macOS screen-recording permission prompt.
            </span>
          </span>
          <Toggle
            checked={settings.preMonitorSystem}
            onChange={(v) => void commit({ preMonitorSystem: v })}
          />
        </label>
      </div>
    </div>
  )
}

function GainRow({
  icon,
  label,
  value,
  onChange,
  onCommit
}: {
  icon: JSX.Element
  label: string
  value: number
  onChange: (v: number) => void
  onCommit: () => void
}): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <span className="flex w-20 shrink-0 items-center gap-1.5 text-[13px] text-muted-foreground">
        {icon}
        {label}
      </span>
      <input
        type="range"
        min={GAIN_MIN}
        max={GAIN_MAX}
        step={GAIN_STEP}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="flex-1"
        aria-label={`${label} gain`}
      />
      <span className="w-8 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {value.toFixed(1)}
      </span>
    </div>
  )
}

// ── AI Summary ───────────────────────────────────────────────────────────────

function SummaryPanel(): JSX.Element {
  const { settings, secretsSet, save, reloadSecrets } = useSettings()
  const [presets, setPresets] = useState<ProviderConfig[]>([])
  // Default absent → greyed-then-enabled once detectProviders resolves (the
  // spinner gate hides this, but it's the safer initial assumption).
  const [detected, setDetected] = useState<{ claude: boolean; codex: boolean }>({
    claude: false,
    codex: false
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    Promise.all([window.meetvox.getProviderPresets(), window.meetvox.detectProviders()])
      .then(([p, d]) => {
        if (cancelled) return
        setPresets(p)
        setDetected(d)
        setLoading(false)
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Displayed providers = presets overlaid with the user's saved config (so edits persist).
  const saved = settings?.summary.providers ?? []
  const savedById = Object.fromEntries(saved.map((p) => [p.id, p]))
  const merged: ProviderConfig[] = presets.map((p) => ({ ...p, ...savedById[p.id] }))
  const defaultId = settings?.summary.defaultProviderId ?? null

  const persist = (next: ProviderConfig[], nextDefault: string | null): void => {
    void save({ summary: { providers: next, defaultProviderId: nextDefault } })
  }

  const updateProvider = (id: string, patch: Partial<ProviderConfig>): void => {
    const next = merged.map((p) => (p.id === id ? { ...p, ...patch } : p))
    // Disabling the current default clears it so pick() can't return a disabled provider.
    const nextDefault = patch.enabled === false && defaultId === id ? null : defaultId
    persist(next, nextDefault)
  }

  const cliAvailable = (id: string): boolean =>
    id === 'claude-cli' ? detected.claude : id === 'codex-cli' ? detected.codex : true

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading providers…</span>
      </div>
    )
  }

  return (
    <div className="max-w-xl space-y-4">
      <div className="space-y-1">
        <SectionTitle>AI Summary</SectionTitle>
        <p className="text-xs text-muted-foreground">
          Enable a provider to summarize meetings. Generating a summary sends the transcript to that
          provider — it leaves your device.
        </p>
      </div>

      <div className="space-y-3">
        {merged.map((provider) => (
          <AiProviderCard
            key={provider.id}
            provider={provider}
            isDefault={defaultId === provider.id}
            keySet={Boolean(secretsSet[provider.id])}
            cliAvailable={cliAvailable(provider.id)}
            onUpdate={(patch) => updateProvider(provider.id, patch)}
            onMakeDefault={() => persist(merged, provider.id)}
            onSaveKey={async (key) => {
              await window.meetvox.setProviderKey(provider.id, key)
              await reloadSecrets()
            }}
            onClearKey={async () => {
              await window.meetvox.clearProviderKey(provider.id)
              await reloadSecrets()
            }}
          />
        ))}
      </div>
    </div>
  )
}

// ── About ────────────────────────────────────────────────────────────────────

function AboutPanel(): JSX.Element {
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => {
    window.meetvox.getAppVersion().then(setVersion).catch(() => setVersion(null))
  }, [])

  return (
    <div className="max-w-xl space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-foreground">Meetvox</h2>
        <p className="text-sm text-muted-foreground">
          {version ? `Version ${version}` : 'Version unavailable'}
        </p>
      </div>
      <div className="space-y-1 text-sm text-muted-foreground">
        <p>Local meeting recorder &amp; transcriber.</p>
        <p>
          Records your mic and system audio, then transcribes it with Whisper, on this Mac or with
          the engine you pick in Transcription settings.
        </p>
      </div>
    </div>
  )
}

// ── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange
}: {
  checked: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`no-drag relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-primary' : 'bg-input'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-background shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
