// Transcription pipeline — orchestrates the full per-meeting flow, a faithful port
// of transcribe_meeting.py: process_meeting + merge_consecutive_speakers +
// save_transcript(_json). External work (ffmpeg split, ffmpeg volumedetect, the
// transcription engine) is injected via PipelineRunners so the orchestration is
// unit-testable; makeRunners() wires ffmpeg plus whichever engine settings chose.

import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'fs'
import { join, basename } from 'path'
import { tmpdir } from 'os'
import { readWavDuration } from '../audio/wav'
import { splitStereoToMono } from './splitChannels'
import { getAudioLevel, isSilent } from './silence'
import {
  sortEntries,
  mergeConsecutiveSpeakers,
  buildTranscriptTxt,
  buildTranscriptJson
} from './format'
import { SPEAKER_LEFT, SPEAKER_RIGHT } from '@shared/constants'
import { pad2 } from '@shared/format'
import type { TranscriptEntry, TranscribeResult, TranscribeProgress } from '@shared/types'

/** The three external operations the pipeline depends on (injectable for tests). */
export interface PipelineRunners {
  split(inputWav: string, leftOut: string, rightOut: string): Promise<void>
  level(wav: string): Promise<number>
  transcribe(wav: string): Promise<string>
}

export interface PipelineOptions {
  onProgress?: (p: TranscribeProgress) => void
  now?: () => Date
  /** Appended to progress messages, e.g. "Groq (whisper-large-v3-turbo)". */
  engineLabel?: string
}

function withEngine(message: string, label: string | undefined): string {
  return label ? `${message} with ${label}` : message
}

/** Build runners: bundled ffmpeg for split/level, the chosen engine for words. */
export function makeRunners(deps: {
  ffmpegPath: string
  transcribe: (wav: string) => Promise<string>
}): PipelineRunners {
  return {
    split: (input, left, right) => splitStereoToMono(deps.ffmpegPath, input, left, right),
    level: (wav) => getAudioLevel(deps.ffmpegPath, wav),
    transcribe: deps.transcribe
  }
}

function listChunks(meetingDir: string): string[] {
  return readdirSync(meetingDir)
    .filter((f) => /^chunk_.*\.wav$/.test(f))
    .sort()
    .map((f) => join(meetingDir, f))
}

/** Process all chunks -> sorted transcript entries (left=You, right=Other). */
export async function processMeeting(
  meetingDir: string,
  runners: PipelineRunners,
  opts: PipelineOptions = {}
): Promise<TranscriptEntry[]> {
  const chunks = listChunks(meetingDir)
  if (chunks.length === 0) {
    throw new Error(`No chunk files found in ${meetingDir}`)
  }

  // Chunk duration from the first file (frames / rate), like the Python.
  const first = readWavDuration(readFileSync(chunks[0]))
  const chunkDuration = first.durationSec

  const entries: TranscriptEntry[] = []
  const tmp = mkdtempSync(join(tmpdir(), 'meetvox-transcribe-'))
  try {
    for (let i = 0; i < chunks.length; i++) {
      const chunkPath = chunks[i]
      const chunkStart = i * chunkDuration
      const leftPath = join(tmp, `left_${i + 1}.wav`)
      const rightPath = join(tmp, `right_${i + 1}.wav`)

      opts.onProgress?.({
        phase: 'running',
        message: withEngine(`Processing chunk ${i + 1}/${chunks.length}`, opts.engineLabel),
        chunkIndex: i + 1,
        chunkCount: chunks.length
      })

      await runners.split(chunkPath, leftPath, rightPath)

      // The two channel level checks are independent ffmpeg runs — run concurrently.
      const [leftLevel, rightLevel] = await Promise.all([
        runners.level(leftPath),
        runners.level(rightPath)
      ])

      // Left channel = mic = "You"
      if (!isSilent(leftLevel)) {
        const text = await runners.transcribe(leftPath)
        if (text) entries.push({ time: chunkStart, speaker: SPEAKER_LEFT, text })
      }
      // Right channel = system = "Other"
      if (!isSilent(rightLevel)) {
        const text = await runners.transcribe(rightPath)
        if (text) entries.push({ time: chunkStart, speaker: SPEAKER_RIGHT, text })
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }

  return sortEntries(entries)
}

function formatGeneratedAt(d: Date): string {
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  )
}

/** Full run: process -> merge -> write transcript.txt + transcript.json. */
export async function runPipeline(
  meetingDir: string,
  runners: PipelineRunners,
  opts: PipelineOptions = {}
): Promise<TranscribeResult> {
  const sorted = await processMeeting(meetingDir, runners, opts)
  const merged = mergeConsecutiveSpeakers(sorted)

  const meetingName = basename(meetingDir)
  const generatedAt = formatGeneratedAt((opts.now ?? (() => new Date()))())

  const txtPath = join(meetingDir, 'transcript.txt')
  const jsonPath = join(meetingDir, 'transcript.json')
  writeFileSync(txtPath, buildTranscriptTxt(merged, meetingName, generatedAt))
  writeFileSync(jsonPath, buildTranscriptJson(merged))

  opts.onProgress?.({
    phase: 'done',
    message: withEngine(`Transcribed ${merged.length} segments`, opts.engineLabel),
    chunkIndex: 0,
    chunkCount: 0
  })

  return { meetingDir, entries: merged, txtPath, jsonPath }
}
