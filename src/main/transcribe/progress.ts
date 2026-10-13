// Saved progress of a stopped (or interrupted) transcription. After each piece of
// audio is transcribed, its entries go into transcript.progress.json in the meeting
// folder, keyed by the audio file name. "Continue" skips the saved pieces, "Start
// over" deletes the file, and a finished run deletes it once transcript.json exists.

import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { TranscriptEntry } from '@shared/types'

export const PROGRESS_FILE = 'transcript.progress.json'

type Pieces = Record<string, TranscriptEntry[]>

/** A recorded meeting's audio pieces (chunk_*.wav), in order, as full paths. */
export function listChunks(meetingDir: string): string[] {
  return readdirSync(meetingDir)
    .filter((f) => /^chunk_.*\.wav$/.test(f))
    .sort()
    .map((f) => join(meetingDir, f))
}

/** Saved pieces by audio file name; {} when there is no readable progress file. */
export function readProgress(meetingDir: string): Pieces {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(meetingDir, PROGRESS_FILE), 'utf8'))
    const pieces: unknown = typeof parsed === 'object' && parsed !== null ? Reflect.get(parsed, 'pieces') : null
    if (typeof pieces !== 'object' || pieces === null) return {}
    return Object.fromEntries(Object.entries(pieces).filter(([, v]) => Array.isArray(v)))
  } catch {
    return {}
  }
}

/** Add one finished piece. Written to a temp file and renamed, so a crash never leaves half a file. */
export function savePiece(meetingDir: string, piece: string, entries: TranscriptEntry[]): void {
  const pieces = { ...readProgress(meetingDir), [piece]: entries }
  const path = join(meetingDir, PROGRESS_FILE)
  writeFileSync(`${path}.tmp`, JSON.stringify({ pieces }))
  renameSync(`${path}.tmp`, path)
}

export function clearProgress(meetingDir: string): void {
  rmSync(join(meetingDir, PROGRESS_FILE), { force: true })
}

/** How far a stopped transcription got, or null when nothing is saved. */
export function progressCounts(meetingDir: string): { done: number; total: number } | null {
  if (!existsSync(join(meetingDir, PROGRESS_FILE))) return null
  return { done: Object.keys(readProgress(meetingDir)).length, total: listChunks(meetingDir).length }
}
