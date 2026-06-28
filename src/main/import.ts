// Audio import — bring outside audio into a NEW meeting folder without ever
// mutating the user's originals. Two shapes:
//
//   importFolder: a folder of recorder-style stereo `chunk_*.wav` files. Each chunk
//     is COPIED (never moved) into a fresh meeting folder; the standard stereo
//     pipeline (runPipeline) transcribes it afterward, so it keeps the load-bearing
//     LEFT=mic="You" / RIGHT=system="Other" mapping → channelMapped:true.
//
//   importFile: a single arbitrary audio file (mp3/mp4/flac/…). It is DECODED (read
//     only) by the bundled ffmpeg into one normalized 16 kHz mono `audio.wav`. A
//     single file carries NO mic/system channel mapping, so it gets ONE neutral
//     "Speaker" label — never You/Other — and channelMapped:false.
//
// External work (ffmpeg decode, whisper transcribe) is injected so the orchestration
// is unit-testable without running real binaries, mirroring transcribe/pipeline.ts.

import {
  readdirSync,
  readFileSync,
  copyFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  rmSync
} from 'fs'
import { join, basename } from 'path'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import { sessionName } from './audio/recorder'
import { readWavDuration } from './audio/wav'
import { serializeMeta } from './meta'
import { buildTranscriptJson, buildTranscriptTxt } from './transcribe/format'
import { SPEAKER_NEUTRAL, WHISPER_INPUT_RATE } from '@shared/constants'
import { pad2 } from '@shared/format'
import type { MeetingMeta, TranscriptEntry } from '@shared/types'

const CHUNK_RE = /^chunk_.*\.wav$/

function listChunkNames(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => CHUNK_RE.test(f))
    .sort()
}

/** Sum the header duration of every chunk (read-only); 0 if none readable. */
function sumChunkDurations(dir: string, names: string[]): number {
  let total = 0
  for (const name of names) {
    try {
      total += readWavDuration(readFileSync(join(dir, name))).durationSec
    } catch {
      // A malformed/short chunk contributes nothing rather than aborting the import.
    }
  }
  return total
}

function writeMeta(meetingDir: string, meta: MeetingMeta): void {
  writeFileSync(join(meetingDir, 'meta.json'), serializeMeta(meta))
}

/**
 * Import a folder of recorder-style stereo chunks into a new meeting folder.
 * COPIES each `chunk_*.wav` (originals are never moved/modified). Throws if the
 * source has no chunk files. The standard stereo pipeline transcribes it after
 * (You/Other), so channelMapped is true.
 */
export function importFolder(
  srcDir: string,
  destRoot: string,
  now: Date
): { meetingDir: string; channelMapped: true } {
  const names = listChunkNames(srcDir)
  if (names.length === 0) {
    throw new Error(`No chunk_*.wav files found in ${srcDir}`)
  }

  const meetingDir = join(destRoot, sessionName(now))
  mkdirSync(meetingDir, { recursive: true })

  for (const name of names) {
    copyFileSync(join(srcDir, name), join(meetingDir, name))
  }

  writeMeta(meetingDir, {
    name: basename(srcDir),
    createdAt: now.toISOString(),
    source: 'imported',
    durationSec: sumChunkDurations(srcDir, names),
    channelMapped: true
  })

  return { meetingDir, channelMapped: true }
}

/** The single external operation importFile depends on (injectable for tests). */
export interface ImportFileDeps {
  spawn: (cmd: string, args: string[]) => ChildProcessWithoutNullStreams
  ffmpegPath: string
}

/**
 * Import a single arbitrary audio file into a new meeting folder by DECODING it
 * (read-only) to one normalized 16 kHz mono pcm_s16le `audio.wav`. No channel
 * split → channelMapped:false. Decoding non-WAV input requires the bigger ffmpeg
 * build (see _plans/finishing/readme.md); the bundled minimal ffmpeg only handles
 * WAV until rebuilt — an honest runtime dependency, not a bug here.
 */
export async function importFile(
  srcFile: string,
  destRoot: string,
  now: Date,
  deps: ImportFileDeps
): Promise<{ meetingDir: string; channelMapped: false }> {
  if (!existsSync(srcFile)) {
    throw new Error(`Import source file not found: ${srcFile}`)
  }

  const meetingDir = join(destRoot, sessionName(now))
  mkdirSync(meetingDir, { recursive: true })

  const dest = join(meetingDir, 'audio.wav')
  const args = [
    '-y',
    '-i',
    srcFile,
    '-ac',
    '1',
    '-ar',
    String(WHISPER_INPUT_RATE),
    '-c:a',
    'pcm_s16le',
    dest
  ]

  try {
    await new Promise<void>((resolve, reject) => {
      const proc = deps.spawn(deps.ffmpegPath, args)
      let stderr = ''
      proc.stderr?.on('data', (d) => {
        stderr += d.toString()
      })
      proc.on('error', (err) => reject(err))
      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`ffmpeg import decode exited ${code}: ${stderr.trim().slice(-500)}`))
          return
        }
        resolve()
      })
    })
  } catch (e) {
    // Decode failed (e.g. an unsupported format on the minimal bundled ffmpeg) —
    // remove the partial meeting folder we just created so it doesn't linger.
    rmSync(meetingDir, { recursive: true, force: true })
    throw e
  }

  // durationSec from the decoded wav header (best-effort; 0 if unreadable).
  let durationSec = 0
  try {
    durationSec = readWavDuration(readFileSync(dest)).durationSec
  } catch {
    durationSec = 0
  }

  writeMeta(meetingDir, {
    name: basename(srcFile),
    createdAt: now.toISOString(),
    source: 'imported',
    durationSec,
    channelMapped: false
  })

  return { meetingDir, channelMapped: false }
}

// Intentionally mirrors transcribe/pipeline.ts's private formatGeneratedAt so the
// imported transcript.txt header matches the recorded one byte-for-byte. Duplicated
// (not shared) because pipeline.ts is a FROZEN engine module we must not edit — if
// that format ever changes there, mirror the change here.
function formatGeneratedAt(d: Date): string {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  )
}

export interface SingleTrackDeps {
  transcribe: (wav: string) => Promise<string>
  now: () => Date
}

/**
 * Transcribe a single-track imported wav with ONE neutral "Speaker" entry (no
 * channel split, no You/Other). Empty transcription → empty-entries transcript.
 * Per-segment timestamps for single-file imports are a future enhancement; this
 * does NOT fabricate them (single entry at time 0).
 */
export async function transcribeSingleTrack(
  meetingDir: string,
  wavPath: string,
  deps: SingleTrackDeps
): Promise<void> {
  const text = await deps.transcribe(wavPath)
  const entries: TranscriptEntry[] = text ? [{ time: 0, speaker: SPEAKER_NEUTRAL, text }] : []

  const generatedAt = formatGeneratedAt(deps.now())
  writeFileSync(join(meetingDir, 'transcript.json'), buildTranscriptJson(entries))
  writeFileSync(
    join(meetingDir, 'transcript.txt'),
    buildTranscriptTxt(entries, basename(meetingDir), generatedAt)
  )
}
