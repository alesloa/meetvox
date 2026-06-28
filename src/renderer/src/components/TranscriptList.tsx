import type { TranscriptEntry } from '@shared/types'
import { fmtClock } from '../lib/format'

interface TranscriptListProps {
  entries: TranscriptEntry[]
  /** true = You/Other split; false = single neutral track import. */
  channelMapped: boolean
}

/**
 * Pick the speaker-label color. The load-bearing invariant: LEFT = mic = `You`,
 * RIGHT = system = `Other`. We never reorder or relabel — only color. For
 * single-track imports there's one neutral label, rendered uniformly.
 */
function speakerClass(speaker: string, channelMapped: boolean): string {
  if (!channelMapped) return 'text-foreground'
  if (speaker === 'You') return 'text-primary'
  if (speaker === 'Other') return 'text-muted-foreground'
  return 'text-foreground'
}

export function TranscriptList({ entries, channelMapped }: TranscriptListProps): JSX.Element {
  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">No transcript yet.</p>
      </div>
    )
  }

  return (
    <div className="custom-scrollbar h-full overflow-y-auto px-4 py-3">
      <ul className="space-y-3">
        {entries.map((e, i) => (
          <li key={`${i}-${e.time}`} className="flex gap-3">
            <span className="mt-0.5 shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
              {fmtClock(e.time)}
            </span>
            <div className="min-w-0 space-y-0.5">
              <span className={`text-xs font-semibold ${speakerClass(e.speaker, channelMapped)}`}>
                {e.speaker}
              </span>
              <p className="break-words text-sm leading-relaxed text-foreground">{e.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
