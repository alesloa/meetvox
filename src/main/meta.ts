// Meeting metadata parse/serialize. Reads/writes meta.json in each meeting folder.
// The folder name (meeting_YYYYMMDD_HHMMSS) is the sole source of the timestamp.

import { basename } from 'path'
import type { MeetingMeta } from '@shared/types'

export function parseMeta(json: string): MeetingMeta {
  let raw: Record<string, unknown> = {}
  try {
    raw = JSON.parse(json) as Record<string, unknown>
  } catch {
    // malformed JSON — use all defaults
  }
  return {
    name: typeof raw.name === 'string' ? raw.name : '',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date(0).toISOString(),
    source: raw.source === 'imported' ? 'imported' : 'recorded',
    durationSec: typeof raw.durationSec === 'number' ? raw.durationSec : 0,
    channelMapped: typeof raw.channelMapped === 'boolean' ? raw.channelMapped : true
  }
}

export function serializeMeta(meta: MeetingMeta): string {
  return JSON.stringify(meta, null, 2)
}

/**
 * Build a MeetingMeta from folder basename `meeting_YYYYMMDD_HHMMSS`.
 * The folder digits are LOCAL wall-clock time — recorder.ts builds the name from
 * local getters (matching the Python script's datetime.now()). So the instant is
 * constructed from local parts; toISOString() then yields the correct UTC instant.
 * (Stamping the local digits with a literal `Z` was the old bug: a 04:26 local
 * recording became 04:26Z = the previous day in any timezone behind UTC, so it
 * showed under "Yesterday". The tz offset is exactly what we want, not what to avoid.)
 */
export function defaultMetaFromFolder(dir: string, opts: { durationSec: number }): MeetingMeta {
  const base = basename(dir)
  // Expected: meeting_20260609_134949
  const m = /^meeting_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(base)
  if (!m) throw new Error(`Cannot parse meeting folder name: ${base}`)

  const [, yyyy, MM, dd, hh, mm, ss] = m
  // Treat the digits as LOCAL time → true UTC instant. Local-time formatters
  // (toLocaleString) render the original wall-clock back, and recency grouping
  // compares the real instant against local midnight, so the bucket is correct.
  const createdAt = new Date(
    Number(yyyy),
    Number(MM) - 1,
    Number(dd),
    Number(hh),
    Number(mm),
    Number(ss)
  ).toISOString()
  // Human label: "Meeting 2026-06-09 13:49" (seconds omitted, matches test)
  const name = `Meeting ${yyyy}-${MM}-${dd} ${hh}:${mm}`

  return {
    name,
    createdAt,
    source: 'recorded',
    durationSec: opts.durationSec,
    channelMapped: true
  }
}
