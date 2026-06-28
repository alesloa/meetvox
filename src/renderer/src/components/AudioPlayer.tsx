import { useCallback, useEffect, useRef, useState } from 'react'
import { Play, Pause, Loader2 } from 'lucide-react'
import type { MeetingAudio } from '@shared/types'
import { fmtClock } from '../lib/format'

interface AudioPlayerProps {
  meetingDir: string
}

/**
 * Custom-controlled player for a recorded meeting's WAV chunks. Loads the ordered
 * source list over IPC, then plays the chunks back-to-back through a single <audio>
 * element. Seeking is per-chunk; the time display is cumulative across the playlist.
 *
 * Seeking works because the meetvox-audio:// handler streams via net.fetch on a
 * file:// URL, which honors HTTP Range — so <audio> can request byte ranges.
 */
export function AudioPlayer({ meetingDir }: AudioPlayerProps): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  // Pending auto-advance frame, cancelled on unmount so play() can't fire on a torn-down element.
  const rafRef = useRef<number>(0)

  const [audio, setAudio] = useState<MeetingAudio | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [currentIndex, setCurrentIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)

  // --- load sources whenever the meeting changes ---
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setAudio(null)
    setCurrentIndex(0)
    setPlaying(false)
    setCurrentTime(0)

    window.meetvox
      .getMeetingAudio(meetingDir)
      .then((res) => {
        if (cancelled) return
        setAudio(res)
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

  // Point <audio> at the active chunk. Reset the per-chunk clock on switch.
  useEffect(() => {
    const el = audioRef.current
    if (!el || !audio || audio.sources.length === 0) return
    el.src = audio.sources[currentIndex]
    setCurrentTime(0)
  }, [audio, currentIndex])

  // --- audio element events ---
  const handleTimeUpdate = useCallback(() => {
    const el = audioRef.current
    if (el) setCurrentTime(el.currentTime)
  }, [])

  const handleEnded = useCallback(() => {
    const el = audioRef.current
    if (audio && currentIndex < audio.sources.length - 1) {
      // Advance + auto-play the next chunk. The src effect loads it (and resets the
      // per-chunk clock); play here once the src swap commits.
      setCurrentIndex((i) => i + 1)
      rafRef.current = requestAnimationFrame(() => {
        // play() rejects with AbortError if the src changed / element detached; ignore it.
        el?.play().catch(() => {})
      })
    } else {
      // Last chunk finished — leave the clock at the end position, just stop.
      setPlaying(false)
    }
  }, [audio, currentIndex])

  const handlePlay = useCallback(() => setPlaying(true), [])
  const handlePause = useCallback(() => setPlaying(false), [])

  // Pause + drop the element source on unmount so nothing keeps playing/leaks.
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current)
      const el = audioRef.current
      if (el) {
        el.pause()
        el.removeAttribute('src')
        el.load()
      }
    }
  }, [])

  const togglePlay = useCallback(() => {
    const el = audioRef.current
    if (!el) return
    if (el.paused) el.play().catch(() => {})
    else el.pause()
  }, [])

  const onSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const el = audioRef.current
    if (!el) return
    const t = Number(e.target.value)
    el.currentTime = t
    setCurrentTime(t)
  }, [])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Loading audio…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
        <p className="text-sm font-medium text-destructive">Couldn’t load audio</p>
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    )
  }

  if (!audio || audio.sources.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">No audio for this meeting.</p>
      </div>
    )
  }

  const chunkDuration = audio.durations[currentIndex] ?? 0
  const elapsedBefore = audio.durations
    .slice(0, currentIndex)
    .reduce((a, b) => a + b, 0)
  const cumulativeElapsed = elapsedBefore + currentTime
  const multipart = audio.sources.length > 1

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        onPlay={handlePlay}
        onPause={handlePause}
      />

      <div className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={togglePlay}
            title={playing ? 'Pause' : 'Play'}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:opacity-90"
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-0.5" />}
          </button>

          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <input
              type="range"
              min={0}
              max={chunkDuration || 0}
              step={0.01}
              value={Math.min(currentTime, chunkDuration || 0)}
              onChange={onSeek}
              aria-label="Seek"
            />
            <div className="flex items-center justify-between font-mono text-xs tabular-nums text-muted-foreground">
              <span>{fmtClock(cumulativeElapsed)}</span>
              <span>{fmtClock(audio.durationSec)}</span>
            </div>
          </div>
        </div>

        {multipart && (
          <p className="text-xs text-muted-foreground">
            Part {currentIndex + 1} of {audio.sources.length}
          </p>
        )}
      </div>
    </div>
  )
}
