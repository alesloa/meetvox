// Meeting library: list, get, rename, delete. Reads/writes meta.json per folder.
// The "recorded" folder structure is: <root>/meeting_YYYYMMDD_HHMMSS/{chunk_NNN.wav, meta.json, ...}

import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join, resolve, basename, sep } from 'path'
import { readWavDuration } from './audio/wav'
import { parseMeta, serializeMeta, defaultMetaFromFolder } from './meta'
import type { Meeting, TranscriptEntry } from '@shared/types'

const MEETING_RE = /^meeting_\d{8}_\d{6}$/

/** Read or backfill meta for a single meeting dir. Writes meta.json if absent. */
async function readOrBackfillMeta(dir: string): Promise<Meeting> {
  const metaPath = join(dir, 'meta.json')
  let meta

  if (existsSync(metaPath)) {
    meta = parseMeta(readFileSync(metaPath, 'utf8'))
    // Self-heal legacy recorded meetings whose createdAt was the local wall-clock
    // digits mislabeled as UTC (the old meta.ts bug — showed under the wrong day).
    // The folder name is the sole source of a recording's timestamp, so re-derive
    // createdAt for recorded meetings and rewrite if it drifted. Renames and every
    // other field are preserved; imported meetings (correct createdAt) are untouched.
    if (meta.source === 'recorded' && MEETING_RE.test(basename(dir))) {
      const correct = defaultMetaFromFolder(dir, { durationSec: meta.durationSec }).createdAt
      if (correct !== meta.createdAt) {
        meta = { ...meta, createdAt: correct }
        writeFileSync(metaPath, serializeMeta(meta), 'utf8')
      }
    }
  } else {
    // Backfill: count chunks + sum duration from WAV headers.
    const entries = existsSync(dir) ? readdirSync(dir) : []
    const chunkFiles = entries.filter((f) => /^chunk_\d{3}\.wav$/.test(f))

    let durationSec = 0
    for (const cf of chunkFiles) {
      try {
        const buf = readFileSync(join(dir, cf))
        durationSec += readWavDuration(buf).durationSec
      } catch {
        // Skip unreadable chunks
      }
    }

    meta = defaultMetaFromFolder(dir, { durationSec })
    writeFileSync(metaPath, serializeMeta(meta), 'utf8')
  }

  return {
    ...meta,
    dir,
    hasTranscript: existsSync(join(dir, 'transcript.json')),
    hasSummary: existsSync(join(dir, 'summary.json'))
  }
}

export async function listMeetings(root: string): Promise<Meeting[]> {
  if (!existsSync(root)) return []

  const names = readdirSync(root).filter((n) => MEETING_RE.test(n))
  const meetings: Meeting[] = []

  for (const name of names) {
    const dir = join(root, name)
    try {
      meetings.push(await readOrBackfillMeta(dir))
    } catch {
      // Skip an unreadable/corrupt meeting folder (bad permissions, disk full on
      // backfill, file vanished after the existsSync check) rather than failing the
      // whole list.
    }
  }

  // Sort descending by createdAt (ISO string sort is lexicographic, which is correct)
  meetings.sort((a, b) => (a.createdAt > b.createdAt ? -1 : a.createdAt < b.createdAt ? 1 : 0))
  return meetings
}

export async function getMeeting(
  dir: string
): Promise<{ meeting: Meeting; entries: TranscriptEntry[] }> {
  const meeting = await readOrBackfillMeta(dir)

  const transcriptPath = join(dir, 'transcript.json')
  let entries: TranscriptEntry[] = []
  if (existsSync(transcriptPath)) {
    try {
      entries = JSON.parse(readFileSync(transcriptPath, 'utf8')) as TranscriptEntry[]
    } catch {
      entries = []
    }
  }

  return { meeting, entries }
}

export async function renameMeeting(dir: string, name: string): Promise<void> {
  if (!name || name.trim().length === 0) throw new Error('Meeting name must not be empty')

  const metaPath = join(dir, 'meta.json')
  let meta
  if (existsSync(metaPath)) {
    meta = parseMeta(readFileSync(metaPath, 'utf8'))
  } else {
    meta = defaultMetaFromFolder(dir, { durationSec: 0 })
  }
  meta.name = name.trim()
  writeFileSync(metaPath, serializeMeta(meta), 'utf8')
}

/** Safety-critical delete: only removes folders that are inside root AND match meeting_YYYYMMDD_HHMMSS. */
export async function deleteMeeting(dir: string, root: string): Promise<void> {
  const absDir = resolve(dir)
  const absRoot = resolve(root)

  // Must be inside root
  if (!absDir.startsWith(absRoot + sep) && absDir !== absRoot) {
    throw new Error(`Refusing to delete: path is not inside recordings root`)
  }

  // Basename must be a meeting folder
  if (!MEETING_RE.test(basename(absDir))) {
    throw new Error(`Refusing to delete: path does not look like a meeting folder (${basename(absDir)})`)
  }

  rmSync(absDir, { recursive: true, force: true })
}
