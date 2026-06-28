import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Pencil,
  Check,
  X,
  Download,
  FolderOpen,
  Trash2,
  Loader2,
  NotebookPen
} from 'lucide-react'
import type { Meeting, TranscriptEntry } from '@shared/types'
import { TranscriptList } from '../components/TranscriptList'
import { AudioPlayer } from '../components/AudioPlayer'
import { NotesEditor } from '../components/NotesEditor'
import { SummaryPane } from '../components/SummaryPane'
import { useMeetings } from '../app/meetings'
import { useRouter } from '../app/router'
import { fmtDate, fmtDuration } from '../lib/format'

interface MeetingViewProps {
  meetingDir: string
}

type ExportFormat = 'md' | 'txt' | 'srt'

const EXPORT_OPTIONS: { format: ExportFormat; label: string }[] = [
  { format: 'md', label: 'Markdown' },
  { format: 'txt', label: 'Plain text' },
  { format: 'srt', label: 'SRT' }
]

export function MeetingView({ meetingDir }: MeetingViewProps): JSX.Element {
  const { refresh } = useMeetings()
  const { navigate } = useRouter()

  const [meeting, setMeeting] = useState<Meeting | null>(null)
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Which pane fills the left column. Resets to transcript when the meeting changes.
  const [tab, setTab] = useState<'transcript' | 'audio' | 'notes'>('transcript')

  // Header interaction state — all reset when meetingDir changes (see effect deps).
  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // Blur is the single rename-commit trigger; Escape sets this so the resulting
  // blur cancels instead of committing (avoids an Enter+blur double rename).
  const cancelNextBlur = useRef(false)
  const exportRef = useRef<HTMLDivElement>(null)

  // --- load the meeting whenever the dir changes ---
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    // Reset all per-meeting header state so a previous meeting's edit/confirm
    // doesn't bleed into the next one.
    setEditing(false)
    setExportOpen(false)
    setSavedPath(null)
    setConfirmDelete(false)
    setActionError(null)
    setTab('transcript')

    window.meetvox
      .getMeeting(meetingDir)
      .then((res) => {
        if (cancelled) return
        setMeeting(res.meeting)
        setEntries(res.entries)
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

  // Close the export menu on Escape or a click outside it.
  useEffect(() => {
    if (!exportOpen) return
    const onMouseDown = (e: MouseEvent): void => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setExportOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [exportOpen])

  const reloadMeeting = useCallback(async () => {
    try {
      const res = await window.meetvox.getMeeting(meetingDir)
      setMeeting(res.meeting)
      setEntries(res.entries)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }, [meetingDir])

  const startEdit = useCallback(() => {
    if (!meeting) return
    setDraftName(meeting.name)
    setActionError(null)
    setEditing(true)
  }, [meeting])

  const commitRename = useCallback(async () => {
    if (!meeting) return
    const next = draftName.trim()
    setEditing(false)
    if (!next || next === meeting.name) return
    try {
      await window.meetvox.renameMeeting(meetingDir, next)
      await reloadMeeting()
      await refresh()
    } catch (e) {
      // Backend rejects empty/invalid names — keep the old name, surface softly.
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }, [meeting, draftName, meetingDir, reloadMeeting, refresh])

  // Single commit path. Enter and click-away both blur the input; Escape blurs
  // too but flags this handler to cancel instead of commit.
  const handleRenameBlur = useCallback(() => {
    if (cancelNextBlur.current) {
      cancelNextBlur.current = false
      setEditing(false)
      return
    }
    void commitRename()
  }, [commitRename])

  const onExport = useCallback(
    async (format: ExportFormat) => {
      setExportOpen(false)
      setActionError(null)
      try {
        const { path } = await window.meetvox.exportTranscript(meetingDir, format)
        if (path) setSavedPath(path) // empty path = user cancelled the save dialog
      } catch (e) {
        setActionError(e instanceof Error ? e.message : String(e))
      }
    },
    [meetingDir]
  )

  const onDelete = useCallback(async () => {
    setActionError(null)
    try {
      await window.meetvox.deleteMeeting(meetingDir)
      await refresh()
      navigate({ type: 'home' })
    } catch (e) {
      setConfirmDelete(false)
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }, [meetingDir, refresh, navigate])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading meeting…</span>
      </div>
    )
  }

  if (error || !meeting) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-sm font-medium text-destructive">Couldn’t load this meeting</p>
        {error && <p className="text-xs text-muted-foreground">{error}</p>}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="no-drag flex shrink-0 flex-col gap-2 border-b border-border px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          {/* Title (inline-editable) */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {editing ? (
              <input
                autoFocus
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={handleRenameBlur}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.currentTarget.blur()
                  } else if (e.key === 'Escape') {
                    e.preventDefault()
                    cancelNextBlur.current = true
                    e.currentTarget.blur()
                  }
                }}
                className="min-w-0 flex-1 rounded-md border border-border bg-input px-2 py-1 text-lg font-semibold text-foreground outline-none focus:border-ring"
              />
            ) : (
              <>
                <h1 className="truncate text-lg font-semibold text-foreground">{meeting.name}</h1>
                <button
                  title="Rename"
                  onClick={startEdit}
                  className="shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </>
            )}
          </div>

          {/* Actions */}
          <div className="flex shrink-0 items-center gap-1">
            {/* Export */}
            <div className="relative" ref={exportRef}>
              <button
                title="Export transcript"
                onClick={() => setExportOpen((v) => !v)}
                className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
              >
                <Download className="h-4 w-4" />
              </button>
              {exportOpen && (
                <div className="absolute right-0 top-full z-10 mt-1 w-36 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-md">
                  {EXPORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.format}
                      onClick={() => onExport(opt.format)}
                      className="block w-full px-3 py-1.5 text-left text-sm text-foreground transition hover:bg-accent hover:text-accent-foreground"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Open folder */}
            <button
              title="Open meeting folder"
              onClick={() => window.meetvox.openMeetingFolder(meetingDir)}
              className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
            >
              <FolderOpen className="h-4 w-4" />
            </button>

            {/* Delete (two-step inline confirm) */}
            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <button
                  title="Confirm delete"
                  onClick={onDelete}
                  className="flex items-center gap-1 rounded-md bg-destructive px-2 py-1 text-xs font-medium text-destructive-foreground transition hover:opacity-90"
                >
                  <Check className="h-3.5 w-3.5" /> Confirm delete
                </button>
                <button
                  title="Cancel"
                  onClick={() => setConfirmDelete(false)}
                  className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <button
                title="Delete meeting"
                onClick={() => setConfirmDelete(true)}
                className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Subtitle: date · duration + badges */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{fmtDate(meeting.createdAt)}</span>
          <span aria-hidden>·</span>
          <span className="font-mono tabular-nums">{fmtDuration(meeting.durationSec)}</span>
          <span className="rounded-full border border-border px-2 py-0.5 capitalize">
            {meeting.source}
          </span>
          <span className="rounded-full border border-border px-2 py-0.5">
            {meeting.channelMapped ? 'You/Other' : 'Single track'}
          </span>
        </div>

        {/* Transient feedback */}
        {savedPath && (
          <p className="truncate text-xs text-muted-foreground">Saved to {savedPath}</p>
        )}
        {actionError && <p className="text-xs text-destructive">{actionError}</p>}
      </header>

      {/* Body: transcript/audio | summary */}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col border-r border-border">
          {/* Left-pane tab bar — switches between transcript, audio player, and notes. */}
          <div className="flex shrink-0 gap-4 border-b border-border px-4">
            {(['transcript', 'audio'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 py-2 text-sm font-medium capitalize transition ${
                  tab === t
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {t}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setTab('notes')}
              className={`-mb-px flex items-center gap-1.5 border-b-2 py-2 text-sm font-medium transition ${
                tab === 'notes'
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <NotebookPen className="h-3.5 w-3.5" />
              Notes
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            {tab === 'transcript' ? (
              <TranscriptList entries={entries} channelMapped={meeting.channelMapped} />
            ) : tab === 'audio' ? (
              <AudioPlayer meetingDir={meetingDir} />
            ) : (
              <NotesEditor meetingDir={meetingDir} />
            )}
          </div>
        </div>
        <SummaryPane meetingDir={meetingDir} />
      </div>
    </div>
  )
}
