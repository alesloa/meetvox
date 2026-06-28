// Transcript formatting — faithful ports of transcribe_meeting.py:
//   format_timestamp, the entry sort, merge_consecutive_speakers, save_transcript
//   (txt) and save_transcript_json. The JSON serializer reproduces Python's
//   json.dump(indent=2) output exactly (integer floats as N.0, ensure_ascii=True).

import { MERGE_WINDOW_SEC } from '@shared/constants'
import { hms } from '@shared/format'
import type { TranscriptEntry } from '@shared/types'

/** seconds -> "HH:MM:SS" (truncating fractional seconds, like Python int()). */
export function formatTimestamp(seconds: number): string {
  return hms(seconds)
}

/** Sort by (time, speaker) — matches `entries.sort(key=lambda x: (x['time'], x['speaker']))`. */
export function sortEntries(entries: TranscriptEntry[]): TranscriptEntry[] {
  return [...entries].sort((a, b) => {
    if (a.time !== b.time) return a.time - b.time
    return a.speaker < b.speaker ? -1 : a.speaker > b.speaker ? 1 : 0
  })
}

/** Merge consecutive same-speaker entries within MERGE_WINDOW_SEC of the run start. */
export function mergeConsecutiveSpeakers(entries: TranscriptEntry[]): TranscriptEntry[] {
  if (entries.length === 0) return []
  const merged: TranscriptEntry[] = []
  let current: TranscriptEntry = { ...entries[0] }

  for (let i = 1; i < entries.length; i++) {
    const entry = entries[i]
    // Note: compares to current.time (the FIRST entry of the run), per Python.
    if (entry.speaker === current.speaker && entry.time - current.time < MERGE_WINDOW_SEC) {
      current.text += ' ' + entry.text
    } else {
      merged.push(current)
      current = { ...entry }
    }
  }
  merged.push(current)
  return merged
}

export function buildTranscriptTxt(
  entries: TranscriptEntry[],
  meetingName: string,
  generatedAt: string
): string {
  let out = `# Meeting Transcript: ${meetingName}\n`
  out += `# Generated: ${generatedAt}\n`
  out += '='.repeat(60) + '\n\n'
  for (const entry of entries) {
    out += `[${formatTimestamp(entry.time)}] ${entry.speaker}:\n`
    out += `${entry.text}\n\n`
  }
  return out
}

// --- Python-compatible JSON serialization (json.dump indent=2, ensure_ascii=True) ---

function pyFloat(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`
}

function jsonStr(s: string): string {
  let out = '"'
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    switch (c) {
      case 0x22:
        out += '\\"'
        break
      case 0x5c:
        out += '\\\\'
        break
      case 0x08:
        out += '\\b'
        break
      case 0x09:
        out += '\\t'
        break
      case 0x0a:
        out += '\\n'
        break
      case 0x0c:
        out += '\\f'
        break
      case 0x0d:
        out += '\\r'
        break
      default:
        // Python ESCAPE_ASCII escapes anything outside the printable ASCII range.
        if (c < 0x20 || c > 0x7e) out += '\\u' + c.toString(16).padStart(4, '0')
        else out += s[i]
    }
  }
  return out + '"'
}

export function buildTranscriptJson(entries: TranscriptEntry[]): string {
  if (entries.length === 0) return '[]'
  const blocks = entries.map((e) => {
    return (
      '  {\n' +
      `    "time": ${pyFloat(e.time)},\n` +
      `    "speaker": ${jsonStr(e.speaker)},\n` +
      `    "text": ${jsonStr(e.text)}\n` +
      '  }'
    )
  })
  return '[\n' + blocks.join(',\n') + '\n]'
}
