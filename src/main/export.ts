// Pure transcript export: md / txt / srt. No I/O — all functions take entries and return a string.

import type { TranscriptEntry } from '@shared/types'

// Assumed on-screen duration for the LAST subtitle block, which has no following
// entry to bound its end time.
const SRT_TAIL_SEC = 3

/** Format seconds as SRT timecode: HH:MM:SS,mmm */
function srtTime(sec: number): string {
  const totalMs = Math.round(sec * 1000)
  const ms = totalMs % 1000
  const totalSec = Math.floor(totalMs / 1000)
  const s = totalSec % 60
  const totalMin = Math.floor(totalSec / 60)
  const m = totalMin % 60
  const h = Math.floor(totalMin / 60)
  return (
    String(h).padStart(2, '0') +
    ':' +
    String(m).padStart(2, '0') +
    ':' +
    String(s).padStart(2, '0') +
    ',' +
    String(ms).padStart(3, '0')
  )
}

export function toSrt(entries: TranscriptEntry[]): string {
  if (entries.length === 0) return ''

  const blocks: string[] = []
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    const start = e.time
    const end = i + 1 < entries.length ? entries[i + 1].time : e.time + SRT_TAIL_SEC
    blocks.push(`${i + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${e.speaker}: ${e.text}\n`)
  }
  return blocks.join('\n')
}

export function toMarkdown(entries: TranscriptEntry[], name: string): string {
  const lines: string[] = [`# ${name}`, '']
  for (const e of entries) {
    lines.push(`**${e.speaker}:** ${e.text}`, '')
  }
  return lines.join('\n')
}

export function toPlainText(entries: TranscriptEntry[]): string {
  if (entries.length === 0) return ''
  return entries.map((e) => `${e.speaker}: ${e.text}`).join('\n')
}
