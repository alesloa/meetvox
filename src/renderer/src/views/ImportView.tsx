import { useCallback, useEffect, useRef, useState } from 'react'
import { FileAudio, FolderOpen, Loader2 } from 'lucide-react'
import { useMeetings } from '../app/meetings'
import { useRouter } from '../app/router'
import { useTranscription } from '../app/transcription'
import { JobProgress } from '../components/TranscribeControls'
import { findLocalModel } from '@shared/transcription'
import { ipcErrorText } from '../lib/ipcError'
import type { ModelDownloadProgress } from '@shared/types'

function fmtBytes(n: number): string {
  if (n <= 0) return '0 MB'
  return `${(n / 1_000_000).toFixed(0)} MB`
}

const ACCEPTED_FORMATS = ['WAV', 'MP3', 'MP4', 'M4A', 'FLAC', 'OGG', 'MKV', 'WebM', 'WMA', 'AIFF']

export function ImportView(): JSX.Element {
  const { refresh } = useMeetings()
  const { navigate } = useRouter()
  const { job } = useTranscription()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [model, setModel] = useState<ModelDownloadProgress | null>(null)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Subscribe at mount (NOT gated on busy) so an early download event isn't dropped.
  // Transcription progress comes from the shared job (useTranscription).
  useEffect(() => window.meetvox.onModelDownloadProgress(setModel), [])

  const runImport = useCallback(
    async (kind: 'file' | 'folder') => {
      setBusy(true)
      setError(null)
      setModel(null)

      try {
        const { meetingDir } = await window.meetvox.importAudio(kind)

        if (!mountedRef.current) return

        if (meetingDir === '') {
          // User cancelled the native picker — silent reset, no error.
          setBusy(false)
          return
        }

        // Done or stopped: refresh the list, then open the new meeting (a stopped
        // import continues from there).
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

        {/* Action buttons: one transcription at a time, so importing waits while any job runs */}
        <div className="flex gap-3">
          <button
            onClick={() => runImport('file')}
            disabled={busy || !!job}
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
            disabled={busy || !!job}
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

        {/* The running transcription with Stop: this import's, or another meeting's (named) */}
        {job && <JobProgress job={job} named={!busy} />}

        {/* Error */}
        {error && (
          <p className="animate-fade-in text-center text-xs text-destructive">{error}</p>
        )}
      </div>
    </div>
  )
}
