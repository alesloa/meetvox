// Opt-in integration test: runs the REAL transcribe pipeline (ffmpeg split +
// volumedetect + whisper-cli) against real chunk_*.wav files using the bundled
// binaries and the downloaded model. Skipped unless all four env vars are set, so
// the normal unit suite (no binaries/model) is unaffected.
//
//   MEETVOX_INT_MEETING   dir containing chunk_*.wav (read-only; chunks are copied)
//   MEETVOX_INT_FFMPEG    path to ffmpeg
//   MEETVOX_INT_WHISPER   path to whisper-cli
//   MEETVOX_INT_MODEL     path to the ggml model
//   MEETVOX_INT_MAX_CHUNKS  optional, default 3 (keep the run short)
//
// It copies a few chunks into a temp meeting dir so it NEVER overwrites the source
// meeting's transcript.txt/json.

import { describe, it, expect } from 'vitest'
import {
  mkdtempSync,
  copyFileSync,
  readdirSync,
  readFileSync,
  existsSync,
  rmSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { runPipeline, makeRunners } from './pipeline'
import { buildTranscriptJson } from './format'

const MEETING = process.env.MEETVOX_INT_MEETING
const FFMPEG = process.env.MEETVOX_INT_FFMPEG
const WHISPER = process.env.MEETVOX_INT_WHISPER
const MODEL = process.env.MEETVOX_INT_MODEL
const MAX = Number(process.env.MEETVOX_INT_MAX_CHUNKS ?? '3')
const ready = Boolean(MEETING && FFMPEG && WHISPER && MODEL)

describe.skipIf(!ready)('runPipeline — real binaries end-to-end', () => {
  it('transcribes real chunks and writes Python-shaped transcript files', async () => {
    const chunks = readdirSync(MEETING!)
      .filter((f) => /^chunk_.*\.wav$/.test(f))
      .sort()
      .slice(0, MAX)
    expect(chunks.length).toBeGreaterThan(0)

    const dir = mkdtempSync(join(tmpdir(), 'meetvox-int-'))
    try {
      for (const c of chunks) copyFileSync(join(MEETING!, c), join(dir, c))

      const runners = makeRunners({ ffmpegPath: FFMPEG!, whisperPath: WHISPER!, modelPath: MODEL! })
      const res = await runPipeline(dir, runners, { now: () => new Date('2026-06-09T14:10:35') })

      expect(existsSync(res.txtPath)).toBe(true)
      expect(existsSync(res.jsonPath)).toBe(true)

      // Every entry maps to a real speaker and carries non-empty text.
      for (const e of res.entries) {
        expect(['You', 'Other']).toContain(e.speaker)
        expect(e.text.length).toBeGreaterThan(0)
      }
      // Sorted by time (sortEntries contract).
      for (let i = 1; i < res.entries.length; i++) {
        expect(res.entries[i].time).toBeGreaterThanOrEqual(res.entries[i - 1].time)
      }
      // The file on disk is exactly our Python-compatible serializer output, and
      // it round-trips through JSON.parse.
      const onDisk = readFileSync(res.jsonPath, 'utf8')
      expect(onDisk).toBe(buildTranscriptJson(res.entries))
      expect(JSON.parse(onDisk).length).toBe(res.entries.length)

      // eslint-disable-next-line no-console
      console.log(
        `\n[integration] ${res.entries.length} entries from ${chunks.length} chunks\n` +
          readFileSync(res.txtPath, 'utf8').slice(0, 1400)
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 600_000)
})
