import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Volume2, RefreshCw, FileText, FolderOpen, Loader2, AudioLines } from 'lucide-react'
import { Card } from '../components/Card'
import { Select } from '../components/Select'
import { VuMeter } from '../components/VuMeter'
import { GainSlider } from '../components/GainSlider'
import { RecordPill } from '../components/RecordPill'
import { useMeetings } from '../app/meetings'
import { useSettings } from '../app/settings'
import { resolveDeviceSelection } from '../lib/deviceSelection'
import { DEFAULT_INTERVAL_SEC, GAIN_DEFAULT, MODEL_FILENAME } from '@shared/constants'
import type {
  DeviceList,
  Levels,
  RecorderStatus,
  TranscribeProgress,
  ModelDownloadProgress
} from '@shared/types'

const EMPTY_DEVICES: DeviceList = { mics: [], systems: [], autoMicId: null, autoSystemId: null }

function fmtBytes(n: number): string {
  if (n <= 0) return '0 MB'
  return `${(n / 1_000_000).toFixed(0)} MB`
}

export function HomeView(): JSX.Element {
  const { refresh: refreshMeetings } = useMeetings()
  const { settings, save: saveSettings, loading: settingsLoading } = useSettings()
  const seededRef = useRef(false)
  const [platform, setPlatform] = useState<'mac' | 'win'>('mac')
  const [devices, setDevices] = useState<DeviceList>(EMPTY_DEVICES)
  const [micId, setMicId] = useState<number | null>(null)
  const [systemId, setSystemId] = useState<number | null>(null)
  const [gains, setGains] = useState({ mic: GAIN_DEFAULT, system: GAIN_DEFAULT })
  const [intervalSec, setIntervalSec] = useState(DEFAULT_INTERVAL_SEC)
  const [levels, setLevels] = useState<Levels>({ mic: 0, system: 0 })
  const [status, setStatus] = useState<RecorderStatus>({
    phase: 'idle',
    message: 'Ready to record',
    chunkCount: 0,
    sessionDir: null
  })
  const [elapsed, setElapsed] = useState(0)
  const [transcribe, setTranscribe] = useState<TranscribeProgress | null>(null)
  const [model, setModel] = useState<ModelDownloadProgress | null>(null)
  const [hasRecording, setHasRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const startMsRef = useRef<number | null>(null)
  const recording = status.phase === 'recording'
  const transcribing =
    transcribe !== null && ['needs-model', 'downloading-model', 'running'].includes(transcribe.phase)

  // --- bootstrap + event subscriptions ---
  useEffect(() => {
    window.meetvox.getPlatform().then(setPlatform)
    window.meetvox.hasRecordings().then(setHasRecording)
    refreshDevices()

    const offLevels = window.meetvox.onLevels(setLevels)
    const offStatus = window.meetvox.onRecorderStatus((s) => {
      setStatus(s)
      if (s.phase === 'idle' && s.sessionDir) setHasRecording(true)
      if (s.phase === 'error') setError(s.message)
    })
    const offTranscribe = window.meetvox.onTranscribeProgress((p) => {
      setTranscribe(p)
      if (p.phase === 'done') setModel(null)
    })
    const offModel = window.meetvox.onModelDownloadProgress((p) => {
      setModel(p)
      if (p.error) setError(p.error)
    })
    return () => {
      offLevels()
      offStatus()
      offTranscribe()
      offModel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- recording timer ---
  useEffect(() => {
    if (!recording) return
    if (startMsRef.current === null) startMsRef.current = Date.now()
    const t = setInterval(() => {
      if (startMsRef.current !== null) {
        setElapsed(Math.floor((Date.now() - startMsRef.current) / 1000))
      }
    }, 1000)
    return () => clearInterval(t)
  }, [recording])

  // --- seed gains + interval from persisted defaults (additive, once) ---
  // Runs the first time settings load. Only seeds while still at the constant
  // defaults — i.e. the user hasn't touched them this session. Device ids are
  // resolved separately (below) so a saved default deterministically beats
  // auto-select instead of racing it.
  useEffect(() => {
    if (!settings || seededRef.current) return
    seededRef.current = true
    setGains((g) =>
      g.mic === GAIN_DEFAULT && g.system === GAIN_DEFAULT ? settings.gains : g
    )
    setIntervalSec((cur) => (cur === DEFAULT_INTERVAL_SEC ? settings.intervalSec : cur))
  }, [settings])

  // --- resolve initial mic / system selection (deterministic precedence) ---
  // Waits until settings finish loading, then applies: explicit in-session pick >
  // saved default > auto-select. Re-runs when the device list arrives/changes.
  // `cur ?? …` inside the resolver preserves a pick the user already made and keeps
  // this idempotent, so it never fights refreshDevices or a persisted choice.
  useEffect(() => {
    if (settingsLoading) return
    setMicId((cur) => resolveDeviceSelection(cur, settings?.defaultMicId, devices.autoMicId))
    setSystemId((cur) =>
      resolveDeviceSelection(cur, settings?.defaultSystemId, devices.autoSystemId)
    )
  }, [settingsLoading, settings, devices])

  // --- live gain sync (Python synced gain to the audio threads continuously) ---
  useEffect(() => {
    window.meetvox.setGain(gains)
  }, [gains])

  // --- pre-record mic monitor lifecycle (additive — independent of record logic) ---
  // Run the live VU monitor whenever Home is mounted, NOT recording, and a mic is
  // selected. The existing onLevels subscription already drives the meters. Restart
  // on micId change; restart when recording flips back to false (handoff returns the
  // mic). Always release the mic on cleanup so the recorder can claim it. Gain is not
  // a dep — it routes live via setGain to whichever stream is active.
  useEffect(() => {
    if (recording || micId === null) return
    // Pass the selected systemId so main can also meter a macOS loopback input
    // (BlackHole) live before recording — no screen-recording prompt. Restart when the
    // system device changes so the meter follows the new selection.
    window.meetvox.startMonitor({ micId, gains, includeSystem: false, systemId }).catch(() => {
      // No device / mic permission denied — fail soft, no crash, no fake levels.
    })
    return () => {
      window.meetvox.stopMonitor().catch(() => {})
    }
    // gains intentionally excluded — live-synced via setGain, not a restart trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micId, systemId, recording])

  const refreshDevices = useCallback(async () => {
    // Just refresh the list; the resolver effect (above) re-applies the
    // pick > saved-default > auto precedence when `devices` changes.
    setDevices(await window.meetvox.listDevices())
  }, [])

  // Persist a device pick the moment the user makes it, so it survives relaunch.
  // (The Settings page already does this; the Home dropdowns did not — that was the
  // "my System Audio choice isn't saved" bug.)
  const onPickMic = useCallback(
    (id: number | null) => {
      setMicId(id)
      void saveSettings({ defaultMicId: id })
    },
    [saveSettings]
  )
  const onPickSystem = useCallback(
    (id: number | null) => {
      setSystemId(id)
      void saveSettings({ defaultSystemId: id })
    },
    [saveSettings]
  )

  const onToggleRecord = useCallback(async () => {
    setError(null)
    if (recording) {
      const res = await window.meetvox.stopRecording()
      setHasRecording(res.chunkCount > 0)
      startMsRef.current = null
      return
    }
    if (micId === null) return setError('Select a microphone first')
    if (systemId === null) return setError('Select a system audio device')
    try {
      startMsRef.current = Date.now()
      setElapsed(0)
      // Release the pre-record monitor so the recorder can open the mic (main also
      // does this defensively in the startRecording handler).
      await window.meetvox.stopMonitor()
      await window.meetvox.startRecording({ micId, systemId, gains, intervalSec })
    } catch (e) {
      startMsRef.current = null
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [recording, micId, systemId, gains, intervalSec])

  // --- tray Start handoff (additive — does NOT restructure record logic) ---
  // The tray menu's "Start Recording" focuses the window and emits trayAction
  // 'start'. Reuse the existing onToggleRecord handler; guard on `recording` so a
  // stray event never double-toggles. (Tray 'stop' is driven directly by the
  // recorder in main, which flips this view via the recorderStatus event.)
  useEffect(() => {
    const off = window.meetvox.onTrayAction((action) => {
      if (action === 'start' && !recording) onToggleRecord()
    })
    return off
  }, [recording, onToggleRecord])

  const onTranscribe = useCallback(async () => {
    setError(null)
    setTranscribe({ phase: 'running', message: 'Starting…', chunkIndex: 0, chunkCount: 0 })
    try {
      await window.meetvox.transcribe()
      // Surface the freshly transcribed meeting in the sidebar/library without a reload.
      await refreshMeetings()
    } catch (e) {
      setTranscribe({
        phase: 'error',
        message: e instanceof Error ? e.message : String(e),
        chunkIndex: 0,
        chunkCount: 0
      })
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [refreshMeetings])

  const controlsDisabled = recording || transcribing
  const systemHint =
    platform === 'mac'
      ? 'Two ways to capture system audio: "System Audio (built-in)" taps the output directly (no setup; macOS may ask for audio-recording permission once), or "BlackHole 2ch" if you route output through a Multi-Output Device that includes BlackHole.'
      : 'Pick "CABLE Output (VB-Audio)" or a VoiceMeeter input if you have one — route Windows output through it (most reliable). Otherwise a render endpoint is captured via WASAPI loopback, where supported.'

  // Welcome empty-state: no recordings and idle
  const showWelcome = !hasRecording && !recording

  return (
    <div className="flex h-full flex-col">
      {showWelcome ? (
        /* Welcome empty state — driven by real hasRecordings() result */
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <AudioLines className="h-10 w-10 text-rec-green" />
          <h1 className="text-xl font-semibold text-foreground">Meetvox</h1>
          <p className="text-sm text-muted-foreground">Start your first meeting</p>
        </div>
      ) : (
        <main className="custom-scrollbar flex-1 space-y-4 overflow-y-auto px-5 pb-4 pt-4">
          {/* Audio devices */}
          <Card title="Audio Devices" icon={<Mic className="h-3.5 w-3.5" />}>
            <div className="space-y-3">
              <Select
                label="Microphone"
                devices={devices.mics}
                value={micId}
                onChange={onPickMic}
                disabled={controlsDisabled}
              />
              <Select
                label="System Audio"
                devices={devices.systems}
                value={systemId}
                onChange={onPickSystem}
                disabled={controlsDisabled}
                hint={systemHint}
              />
              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={refreshDevices}
                  disabled={controlsDisabled}
                  className="no-drag flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-accent disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </button>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Auto-save every
                  <input
                    type="number"
                    min={1}
                    value={intervalSec}
                    disabled={controlsDisabled}
                    onChange={(e) => {
                      const v = Math.max(1, parseInt(e.target.value || '30', 10) || 30)
                      setIntervalSec(v)
                      void saveSettings({ intervalSec: v })
                    }}
                    className="w-14 rounded-md border border-border bg-input px-2 py-1 text-center font-mono text-foreground outline-none focus:border-ring disabled:opacity-50"
                  />
                  s
                </label>
              </div>
            </div>
          </Card>

          {/* Audio levels */}
          <Card title="Audio Levels" icon={<Volume2 className="h-3.5 w-3.5" />}>
            <div className="space-y-3.5">
              <div className="flex items-center gap-3">
                <span className="flex w-16 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <Mic className="h-3.5 w-3.5" /> Mic
                </span>
                <VuMeter level={levels.mic} />
                <GainSlider
                  value={gains.mic}
                  onChange={(v) => setGains((g) => ({ ...g, mic: v }))}
                />
              </div>
              <div className="flex items-center gap-3">
                <span className="flex w-16 shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                  <Volume2 className="h-3.5 w-3.5" /> System
                </span>
                <VuMeter level={levels.system} />
                <GainSlider
                  value={gains.system}
                  onChange={(v) => setGains((g) => ({ ...g, system: v }))}
                />
              </div>
            </div>
          </Card>

          {/* Status */}
          <div className="flex flex-col items-center gap-1 py-1">
            <p
              className={`text-sm ${
                recording ? 'text-rec-red' : error ? 'text-rec-red' : 'text-muted-foreground'
              }`}
            >
              {error ?? status.message}
            </p>
          </div>

          {/* Transcribe */}
          <button
            onClick={onTranscribe}
            disabled={recording || transcribing || !hasRecording}
            className="no-drag flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card py-3 text-sm font-medium text-foreground transition hover:bg-accent disabled:opacity-40"
          >
            {transcribing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            {transcribing ? 'Transcribing…' : 'Transcribe Last Recording'}
          </button>

          {/* Model download progress */}
          {model && !model.done && !model.error && (
            <div className="animate-fade-in rounded-lg border border-border bg-card p-3">
              <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                <span>Downloading model ({MODEL_FILENAME})</span>
                <span className="font-mono tabular-nums">
                  {fmtBytes(model.receivedBytes)}
                  {model.totalBytes > 0 ? ` / ${fmtBytes(model.totalBytes)}` : ''}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/60">
                <div
                  className="h-full rounded-full bg-rec-green transition-[width] duration-200"
                  style={{
                    width: model.fraction >= 0 ? `${Math.round(model.fraction * 100)}%` : '40%'
                  }}
                />
              </div>
            </div>
          )}

          {/* Transcribe progress */}
          {transcribe && transcribe.phase === 'running' && transcribe.chunkCount > 0 && (
            <div className="animate-fade-in rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
              <div className="mb-1.5 flex items-center justify-between">
                <span>{transcribe.message}</span>
                <span className="font-mono tabular-nums">
                  {transcribe.chunkIndex}/{transcribe.chunkCount}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/60">
                <div
                  className="h-full rounded-full bg-muted transition-[width] duration-200"
                  style={{ width: `${(transcribe.chunkIndex / transcribe.chunkCount) * 100}%` }}
                />
              </div>
            </div>
          )}

          {transcribe && transcribe.phase === 'done' && (
            <p className="animate-fade-in text-center text-sm text-rec-green">{transcribe.message}</p>
          )}

          {/* Open folder */}
          <button
            onClick={() => window.meetvox.openMeetingFolder()}
            className="no-drag mx-auto flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Open Last Meeting Folder
          </button>
        </main>
      )}

      {/* Record bar — a fixed footer (shrink-0) so the scroll area above shrinks to
          fit and never collides with the pill. Always rendered, centered, so Record is
          reachable in the welcome state too. */}
      <footer className="flex shrink-0 items-center justify-center border-t border-border/60 px-5 py-4">
        <RecordPill
          recording={recording}
          transcribing={transcribing}
          status={status}
          elapsed={elapsed}
          onToggle={onToggleRecord}
        />
      </footer>
    </div>
  )
}
