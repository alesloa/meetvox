import { FileText, Sparkles, Loader2 } from 'lucide-react'
import type { Meeting } from '@shared/types'
import { useMeetings } from '../app/meetings'
import { useRouter } from '../app/router'
import { fmtDate, fmtDuration } from '../lib/format'

function MeetingCard({ meeting }: { meeting: Meeting }): JSX.Element {
  const { navigate } = useRouter()
  return (
    <button
      onClick={() => navigate({ type: 'openMeeting', dir: meeting.dir })}
      className="no-drag flex w-full flex-col gap-2 rounded-xl border border-border bg-card p-4 text-left transition hover:bg-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {meeting.name}
        </span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {fmtDuration(meeting.durationSec)}
        </span>
      </div>
      <span className="text-xs text-muted-foreground">{fmtDate(meeting.createdAt)}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full border border-border px-2 py-0.5 text-xs capitalize text-muted-foreground">
          {meeting.source}
        </span>
        {meeting.hasTranscript && (
          <span className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
            <FileText className="h-3 w-3" /> Transcript
          </span>
        )}
        {meeting.hasSummary && (
          <span className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3" /> Summary
          </span>
        )}
      </div>
    </button>
  )
}

export function LibraryView(): JSX.Element {
  const { meetings, loading, error } = useMeetings()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <p className="text-sm font-medium text-destructive">Couldn’t load meetings</p>
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    )
  }

  if (meetings.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-sm font-medium text-foreground">No meetings yet</p>
        <p className="text-xs text-muted-foreground">
          Record one from Home or import audio.
        </p>
      </div>
    )
  }

  return (
    <div className="custom-scrollbar h-full overflow-y-auto px-5 py-4">
      <h1 className="mb-3 text-sm font-semibold text-foreground">Library</h1>
      <div className="space-y-2">
        {meetings.map((m) => (
          <MeetingCard key={m.dir} meeting={m} />
        ))}
      </div>
    </div>
  )
}
