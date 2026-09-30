import { useCallback, useEffect, useRef, useState } from 'react'
import { FileAudio, FolderOpen, Loader2 } from 'lucide-react'
import { useMeetings } from '../app/meetings'
import { useRouter } from '../app/router'
import { findLocalModel } from '@shared/transcription'
import { ipcErrorText } from '../lib/ipcError'
import type { ModelDownloadProgress, TranscribeProgress } from '@shared/types'

function fmtBytes(n: number): string {
  if (n <= 0) return '0 MB'
  return `${(n / 1_000_000).toFixed(0)} MB`
}

const ACCEPTED_FORMATS = ['WAV', 'MP3', 'MP4', 'M4A', 'FLAC', 'OGG', 'MKV', 'WebM', 'WMA', 'AIFF']

export function ImportView(): JSX.Element {
  const { refresh } = useMeetings()
  const { navigate } = useRouter()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [transcribe, setTranscribe] = useState<TranscribeProgress | null>(null)
  const [model, setModel] = useState<ModelDownloadProgress | null>(null)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Subscribe to progress events at mount (NOT gated on busy) so an early
  // needs-model/running event emitted before the next render isn't dropped.
  // Progress state is only rendered while busy, so off-import updates are inert.
  useEffect(() => {
    const offTranscribe = window.meetvox.onTranscribeProgress((p) => {
      if (!mountedRef.current) return
      setTranscribe(p)
      if (p.phase === 'done') setModel(null)
    })
    const offModel = window.meetvox.onModelDownloadProgress((p) => {
      if (!mountedRef.current) return
      setModel(p)
    })

    return () => {
      offTranscribe()
      offModel()
    }
  }, [])

  const runImport = useCallback(
    async (kind: 'file' | 'folder') => {
      setBusy(true)
      setError(null)
      setTranscribe(null)
      setModel(null)

      try {
        const { meetingDir } = await window.meetvox.importAudio(kind)

        if (!mountedRef.current) return

        if (meetingDir === '') {
          // User cancelled the native picker — silent reset, no error.
          setBusy(false)
          return
        }

        // Success: refresh list then navigate to the new meeting.
        await refresh()
        if (!mountedRef.current) return
        navigate({ type: 'openMeeting', dir: meetingDir })
      } catch (e) {
        if (!mountedRef.current) return
        setError(ipcErrorText(e))
        setBusy(false)
      }
    },
    [refresh, navigate]
  )

  const progressMessage = (() => {
    if (model && !model.done && !model.error) return null // model bar rendered separately below
    if (!transcribe) return null
    // While the chunk bar is up it already shows the message — don't print it twice.
    if (transcribe.phase === 'running' && transcribe.chunkCount > 0) return null
    return transcribe.message
  })()

  return (
    <div className="custom-scrollbar flex h-full flex-col overflow-y-auto px-5 py-6">
      <div className="mx-auto w-full max-w-md space-y-6">
        {/* Header */}
        <div className="space-y-1">
          <h1 className="text-base font-semibold text-foreground">Import Recording</h1>
          <p className="text-xs text-muted-foreground">
            Add an existing recording — a single audio file, or a folder of{' '}
            <span className="font-mono">chunk_*.wav</span> from a prior session.
          </p>
        </div>

        {/* Accepted formats */}
        <div className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="mb-2 text-xs font-medium text-foreground">Accepted formats</p>
          <div className="flex flex-wrap gap-1.5">
            {ACCEPTED_FORMATS.map((fmt) => (
              <span
                key={fmt}
                className="rounded-full border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground"
              >
                {fmt}
              </span>
            ))}
          </div>
          <p className="mt-2.5 text-xs text-muted-foreground">
            WAV files import directly. Other formats are decoded by the bundled ffmpeg — a build
            with the extra codecs is required for those (see the project’s resources notes).
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => runImport('file')}
            disabled={busy}
            className="no-drag flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-card py-3 text-sm font-medium text-foreground transition hover:bg-accent disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileAudio className="h-4 w-4" />
            )}
            Import File
          </button>
          <button
            onClick={() => runImport('folder')}
            disabled={busy}
            className="no-drag flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-card py-3 text-sm font-medium text-foreground transition hover:bg-accent disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FolderOpen className="h-4 w-4" />
            )}
            Import Folder
          </button>
        </div>

        {/* Model download progress */}
        {model && !model.done && !model.error && (
          <div className="animate-fade-in rounded-lg border border-border bg-card p-3">
            <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
              <span>Downloading {findLocalModel(model.file)?.label ?? model.file}</span>
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

        {/* Transcribe chunk progress */}
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

        {/* General progress message (needs-model / single-chunk running) */}
        {progressMessage && (
          <p className="animate-fade-in text-center text-xs text-muted-foreground">
            {progressMessage}
          </p>
        )}

        {/* Error */}
        {error && (
          <p className="animate-fade-in text-center text-xs text-destructive">{error}</p>
        )}
      </div>
    </div>
  )
}
