import { Square, Mic } from 'lucide-react'
import { hms } from '@shared/format'
import type { RecorderStatus } from '@shared/types'

interface RecordPillProps {
  recording: boolean
  transcribing: boolean
  status: RecorderStatus
  elapsed: number
  onToggle: () => void
}

export function RecordPill({
  recording,
  transcribing,
  status,
  elapsed,
  onToggle
}: RecordPillProps): JSX.Element {
  return (
    <button
      onClick={onToggle}
      disabled={transcribing}
      className={`no-drag flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white shadow-lg transition active:scale-[0.98] disabled:opacity-50 ${
        recording
          ? 'bg-rec-red hover:bg-rec-red-hover'
          : 'bg-rec-green hover:bg-rec-green-hover'
      }`}
    >
      {recording ? (
        <>
          <Square className="h-4 w-4 fill-current" />
          <span>Stop</span>
          <span className="font-mono tabular-nums">{hms(elapsed)}</span>
          {status.chunkCount > 0 && (
            <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs tabular-nums">
              {status.chunkCount} chunks
            </span>
          )}
        </>
      ) : (
        // Inner flex with a tight gap so the mic sits right next to "Record",
        // independent of the wider gap the recording state needs.
        <span className="flex items-center gap-1">
          <Mic className="h-4 w-4" />
          <span>Record</span>
        </span>
      )}
    </button>
  )
}
