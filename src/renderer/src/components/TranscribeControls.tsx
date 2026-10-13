import { FileText, Play, RotateCcw, Square } from 'lucide-react'
import type { Meeting, TranscribeEvent } from '@shared/types'
import { useMeetings } from '../app/meetings'
import { useTranscription } from '../app/transcription'
import { controlsState } from '../lib/transcribeControls'

const BIG_BUTTON =
  'no-drag flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card py-3 text-sm font-medium text-foreground transition hover:bg-accent disabled:opacity-40'

/** The running job's message, chunk counter and bar, with an optional Stop. */
export function JobProgress({ job, label }: { job: TranscribeEvent; label?: string }): JSX.Element {
  const { stop } = useTranscription()
  return (
    <div className="animate-fade-in rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate">{label ? `${label}: ${job.message}` : job.message}</span>
        <div className="flex shrink-0 items-center gap-3">
          {job.chunkCount > 0 && (
            <span className="font-mono tabular-nums">
              {job.chunkIndex}/{job.chunkCount}
            </span>
          )}
          <button
            onClick={stop}
            className="no-drag flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-foreground transition hover:bg-accent"
          >
            <Square className="h-3 w-3 fill-current" />
            Stop
          </button>
        </div>
      </div>
      {job.chunkCount > 0 && (
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-black/60">
          <div
            className="h-full rounded-full bg-muted transition-[width] duration-200"
            style={{ width: `${(job.chunkIndex / job.chunkCount) * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}

interface TranscribeControlsProps {
  meetingDir: string
  progress: Meeting['progress']
  hasTranscript: boolean
  /** Home's wording ("Transcribe Last Recording"); meeting pages use Transcribe / Transcribe again. */
  startLabel?: string
  /** Why starting is not possible right now, e.g. the meeting is still recording. */
  blockedReason?: string | null
}

/** Transcribe, Stop, Continue / Start over for one meeting, plus how its last run ended. */
export function TranscribeControls({
  meetingDir,
  progress,
  hasTranscript,
  startLabel,
  blockedReason
}: TranscribeControlsProps): JSX.Element {
  const { meetings } = useMeetings()
  const { job, ended, start } = useTranscription()
  const state = controlsState({ job, meetingDir, progress, hasTranscript })
  const endedHere = ended?.meetingDir === meetingDir ? ended : null
  const blocked = !!blockedReason || state.kind === 'busy'

  let controls: JSX.Element
  switch (state.kind) {
    case 'running':
      controls = <JobProgress job={state.job} />
      break
    case 'stopped':
      controls = (
        <div className="space-y-2">
          <p className="text-center text-xs text-muted-foreground">
            Stopped at {state.done} of {state.total}
          </p>
          <div className="flex gap-3">
            <button onClick={() => start(meetingDir, 'continue')} disabled={blocked} className={BIG_BUTTON}>
              <Play className="h-4 w-4" />
              Continue
            </button>
            <button onClick={() => start(meetingDir, 'fresh')} disabled={blocked} className={BIG_BUTTON}>
              <RotateCcw className="h-4 w-4" />
              Start over
            </button>
          </div>
        </div>
      )
      break
    case 'busy':
    case 'idle':
      controls =
        state.kind === 'idle' && state.hasTranscript && !startLabel ? (
          <div className="flex justify-end">
            <button
              onClick={() => start(meetingDir, 'fresh')}
              disabled={blocked}
              className="no-drag flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Transcribe again
            </button>
          </div>
        ) : (
          <button onClick={() => start(meetingDir, 'fresh')} disabled={blocked} className={BIG_BUTTON}>
            <FileText className="h-4 w-4" />
            {startLabel ?? 'Transcribe'}
          </button>
        )
      break
    default: {
      const _exhaustive: never = state
      throw new Error(`Unknown controls state: ${JSON.stringify(_exhaustive)}`)
    }
  }

  const nameOf = (dir: string): string =>
    meetings.find((m) => m.dir === dir)?.name ?? 'Another meeting'

  return (
    <div className="space-y-2">
      {controls}
      {state.kind === 'busy' && <JobProgress job={state.job} label={nameOf(state.job.meetingDir)} />}
      {blockedReason && state.kind !== 'busy' && (
        <p className="text-center text-xs text-muted-foreground">{blockedReason}</p>
      )}
      {endedHere?.phase === 'done' && (
        <p className="animate-fade-in text-center text-sm text-rec-green">{endedHere.message}</p>
      )}
      {endedHere?.phase === 'error' && (
        <p className="animate-fade-in text-center text-xs text-destructive">{endedHere.message}</p>
      )}
    </div>
  )
}
