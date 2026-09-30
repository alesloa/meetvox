import { useCallback, useEffect, useState } from 'react'
import { Check, Download, Loader2, AlertCircle } from 'lucide-react'
import { ApiKeyField } from './ApiKeyField'
import { Field, SectionTitle } from './SettingsField'
import { useSettings } from '../app/settings'
import { fmtBytes } from '../lib/format'
import { ipcErrorText } from '../lib/ipcError'
import {
  CLOUD_PROVIDERS,
  DEFAULT_SERVER_URL,
  ENGINE_LABELS,
  LOCAL_MODELS,
  normalizeServerUrl,
  type CloudProvider,
  type TranscriptionEngine
} from '@shared/transcription'
import type {
  EngineTestResult,
  ModelDownloadProgress,
  Settings,
  TranscriptionSettings
} from '@shared/types'

const ENGINES: TranscriptionEngine[] = ['local', 'server', 'openai', 'groq']

const ENGINE_HINTS: Record<TranscriptionEngine, string> = {
  local: 'Runs on this Mac. Your audio never leaves your computer.',
  server: 'Sends audio to a whisper.cpp server, like one on a faster computer on your network.',
  openai: 'Sends audio to OpenAI to transcribe. It leaves your computer.',
  groq: 'Sends audio to Groq to transcribe. It leaves your computer.'
}

type Update = (patch: Partial<TranscriptionSettings>) => void

export function TranscriptionPanel({
  settings,
  commit
}: {
  settings: Settings
  commit: (p: Partial<Settings>) => Promise<void>
}): JSX.Element {
  const t = settings.transcription
  const update: Update = (patch) => void commit({ transcription: { ...t, ...patch } })

  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-2">
        <SectionTitle>Engine</SectionTitle>
        <div role="radiogroup" className="inline-flex rounded-lg border border-border bg-card p-1">
          {ENGINES.map((engine) => {
            const active = t.engine === engine
            return (
              <button
                key={engine}
                role="radio"
                aria-checked={active}
                onClick={() => update({ engine })}
                className={`no-drag rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {ENGINE_LABELS[engine]}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">{ENGINE_HINTS[t.engine]}</p>
      </div>

      {t.engine === 'local' && <LocalEngine t={t} update={update} />}
      {t.engine === 'server' && <ServerEngine t={t} update={update} />}
      {(t.engine === 'openai' || t.engine === 'groq') && (
        <CloudEngine provider={CLOUD_PROVIDERS[t.engine]} t={t} update={update} />
      )}

      <p className="text-xs text-muted-foreground">
        Translation is not available; audio is transcribed in its original language.
      </p>
    </div>
  )
}

// ── This Mac ─────────────────────────────────────────────────────────────────

function LocalEngine({ t, update }: { t: TranscriptionSettings; update: Update }): JSX.Element {
  const [downloaded, setDownloaded] = useState<Record<string, boolean>>({})
  const [progress, setProgress] = useState<Record<string, ModelDownloadProgress>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})

  const refresh = useCallback(async () => {
    const list = await window.meetvox.listLocalModels()
    setDownloaded(Object.fromEntries(list.map((m) => [m.file, m.downloaded])))
  }, [])

  useEffect(() => {
    void refresh()
    return window.meetvox.onModelDownloadProgress((p) => {
      const error = p.error
      if (error) {
        setProgress(({ [p.file]: _failed, ...rest }) => rest)
        setErrors((prev) => ({ ...prev, [p.file]: error }))
        return
      }
      setProgress((prev) => ({ ...prev, [p.file]: p }))
      if (p.done) void refresh()
    })
  }, [refresh])

  const download = async (file: string): Promise<void> => {
    setErrors(({ [file]: _cleared, ...rest }) => rest)
    try {
      await window.meetvox.downloadLocalModel(file)
    } catch (e) {
      setErrors((prev) => ({ ...prev, [file]: ipcErrorText(e) }))
    } finally {
      setProgress(({ [file]: _done, ...rest }) => rest)
      void refresh()
    }
  }

  return (
    <div className="space-y-2">
      <SectionTitle>Model</SectionTitle>
      <div role="radiogroup" className="space-y-2">
        {LOCAL_MODELS.map((m) => {
          const selected = t.localModel === m.file
          return (
            <div
              key={m.file}
              className={`rounded-lg border p-3 ${selected ? 'border-ring bg-accent' : 'border-border bg-card'}`}
            >
              <div className="flex items-start gap-3">
                <button
                  role="radio"
                  aria-checked={selected}
                  onClick={() => update({ localModel: m.file })}
                  className="no-drag flex min-w-0 flex-1 items-start gap-3 text-left"
                >
                  <RadioDot checked={selected} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">{m.label}</span>
                    <span className="text-xs text-muted-foreground">{m.note}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {m.file} · {fmtBytes(m.bytes)}
                    </span>
                  </span>
                </button>
                <div className="shrink-0 pt-0.5">
                  <ModelStatus
                    downloaded={downloaded[m.file]}
                    progress={progress[m.file]}
                    onDownload={() => void download(m.file)}
                  />
                </div>
              </div>
              {errors[m.file] && <p className="mt-2 text-xs text-destructive">{errors[m.file]}</p>}
            </div>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        If the model you pick isn&apos;t downloaded yet, it downloads the first time you transcribe.
      </p>
    </div>
  )
}

function ModelStatus({
  downloaded,
  progress,
  onDownload
}: {
  downloaded: boolean | undefined
  progress: ModelDownloadProgress | undefined
  onDownload: () => void
}): JSX.Element {
  if (downloaded) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Check className="h-3.5 w-3.5 text-rec-green" /> Downloaded
      </span>
    )
  }
  if (progress) {
    return (
      <span className="flex items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {Math.round(Math.max(0, progress.fraction) * 100)}%
      </span>
    )
  }
  return (
    <button
      onClick={onDownload}
      className="no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-foreground transition hover:bg-accent"
    >
      <Download className="h-3.5 w-3.5" />
      Download
    </button>
  )
}

// ── Whisper server ───────────────────────────────────────────────────────────

function ServerEngine({ t, update }: { t: TranscriptionSettings; update: Update }): JSX.Element {
  const [draft, setDraft] = useState(t.serverUrl)
  useEffect(() => setDraft(t.serverUrl), [t.serverUrl])

  const save = (): void => {
    const url = normalizeServerUrl(draft)
    setDraft(url)
    if (url !== t.serverUrl) update({ serverUrl: url })
  }

  return (
    <div className="space-y-3">
      <Field
        label="Server address"
        hint="A whisper.cpp server (whisper-server). Meetvox sends audio to its /inference address. The server uses whichever model it loaded."
      >
        <input
          type="text"
          value={draft}
          placeholder={DEFAULT_SERVER_URL}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          className="w-full rounded-md border border-border bg-input px-3 py-2 font-mono text-xs text-foreground outline-none focus:border-ring"
        />
      </Field>
      <TestButton settings={{ ...t, serverUrl: normalizeServerUrl(draft) }} />
    </div>
  )
}

// ── OpenAI / Groq ────────────────────────────────────────────────────────────

function CloudEngine({
  provider,
  t,
  update
}: {
  provider: CloudProvider
  t: TranscriptionSettings
  update: Update
}): JSX.Element {
  const { secretsSet, reloadSecrets } = useSettings()
  const model = provider.engine === 'openai' ? t.openaiModel : t.groqModel
  const setModel = (id: string): void =>
    update(provider.engine === 'openai' ? { openaiModel: id } : { groqModel: id })

  return (
    <div className="space-y-5">
      <Field
        label={`${provider.label} API key`}
        hint={
          provider.engine === 'openai'
            ? 'Stored encrypted on this Mac. The same key is used by AI Summary → OpenAI.'
            : 'Stored encrypted on this Mac.'
        }
      >
        <ApiKeyField
          keySet={Boolean(secretsSet[provider.secretId])}
          onSaveKey={async (key) => {
            await window.meetvox.setProviderKey(provider.secretId, key)
            await reloadSecrets()
          }}
          onClearKey={async () => {
            await window.meetvox.clearProviderKey(provider.secretId)
            await reloadSecrets()
          }}
        />
      </Field>

      <div className="space-y-2">
        <SectionTitle>Model</SectionTitle>
        <div role="radiogroup" className="space-y-2">
          {provider.models.map((m) => {
            const selected = model === m.id
            return (
              <button
                key={m.id}
                role="radio"
                aria-checked={selected}
                onClick={() => setModel(m.id)}
                className={`no-drag flex w-full items-start gap-3 rounded-lg border p-3 text-left ${
                  selected ? 'border-ring bg-accent' : 'border-border bg-card hover:bg-accent'
                }`}
              >
                <RadioDot checked={selected} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-mono text-[13px] text-foreground">{m.id}</span>
                  <span className="text-xs text-muted-foreground">{m.note}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <TestButton settings={t} />
    </div>
  )
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function RadioDot({ checked }: { checked: boolean }): JSX.Element {
  return (
    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-border bg-background">
      {checked && <span className="h-2 w-2 rounded-full bg-primary" />}
    </span>
  )
}

/** Sends 1 second of silence through the engine and shows what came back. */
function TestButton({ settings }: { settings: TranscriptionSettings }): JSX.Element {
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<EngineTestResult | null>(null)

  // A changed address, key or model makes the old result stale.
  const key = JSON.stringify(settings)
  useEffect(() => setResult(null), [key])

  const run = async (): Promise<void> => {
    setTesting(true)
    setResult(null)
    try {
      setResult(await window.meetvox.testTranscription(settings))
    } catch (e) {
      setResult({ ok: false, error: ipcErrorText(e) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => void run()}
        disabled={testing}
        className="no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-foreground transition hover:bg-accent disabled:opacity-50"
      >
        {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {testing ? 'Testing…' : 'Test'}
      </button>
      {result?.ok && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Check className="h-3.5 w-3.5 text-rec-green" />
          Works. Answered in {(result.ms / 1000).toFixed(1)} s.
        </p>
      )}
      {result && !result.ok && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{result.error}</span>
        </p>
      )}
      {!result && !testing && (
        <p className="text-xs text-muted-foreground">Sends one second of silence to check that it works.</p>
      )}
    </div>
  )
}
