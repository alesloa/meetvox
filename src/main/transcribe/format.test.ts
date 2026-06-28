import { describe, it, expect } from 'vitest'
import {
  formatTimestamp,
  sortEntries,
  mergeConsecutiveSpeakers,
  buildTranscriptTxt,
  buildTranscriptJson
} from './format'
import type { TranscriptEntry } from '@shared/types'

describe('formatTimestamp — mirrors format_timestamp', () => {
  it('truncates fractional seconds to HH:MM:SS', () => {
    expect(formatTimestamp(0)).toBe('00:00:00')
    expect(formatTimestamp(59.81460317460318)).toBe('00:00:59')
    expect(formatTimestamp(119.62920634920636)).toBe('00:01:59')
    expect(formatTimestamp(3661.9)).toBe('01:01:01')
    expect(formatTimestamp(7200)).toBe('02:00:00')
  })
})

describe('sortEntries — sort by (time, speaker)', () => {
  it('orders by time then speaker name', () => {
    const e: TranscriptEntry[] = [
      { time: 10, speaker: 'You', text: 'b' },
      { time: 10, speaker: 'Other', text: 'a' },
      { time: 0, speaker: 'You', text: 'first' }
    ]
    expect(sortEntries(e).map((x) => x.text)).toEqual(['first', 'a', 'b'])
  })
})

describe('mergeConsecutiveSpeakers — same speaker within 35s of the run start', () => {
  it('merges same-speaker entries with a single space, comparing to the run start time', () => {
    const e: TranscriptEntry[] = [
      { time: 0, speaker: 'You', text: 'hello' },
      { time: 30, speaker: 'You', text: 'world' }, // 30 - 0 < 35 -> merge
      { time: 60, speaker: 'You', text: 'again' } // 60 - 0 = 60 NOT < 35 -> new run
    ]
    const merged = mergeConsecutiveSpeakers(e)
    expect(merged).toEqual([
      { time: 0, speaker: 'You', text: 'hello world' },
      { time: 60, speaker: 'You', text: 'again' }
    ])
  })

  it('does not merge across different speakers', () => {
    const e: TranscriptEntry[] = [
      { time: 0, speaker: 'You', text: 'a' },
      { time: 0, speaker: 'Other', text: 'b' }
    ]
    expect(mergeConsecutiveSpeakers(e)).toEqual(e)
  })

  it('returns [] for empty input', () => {
    expect(mergeConsecutiveSpeakers([])).toEqual([])
  })
})

describe('buildTranscriptTxt — exact save_transcript format', () => {
  it('reproduces the header, separator and per-entry blocks', () => {
    const entries: TranscriptEntry[] = [
      { time: 0, speaker: 'You', text: 'line one' },
      { time: 59.8, speaker: 'Other', text: 'line two' }
    ]
    const txt = buildTranscriptTxt(entries, 'meeting_20260609_134949', '2026-06-09 14:10:35')
    expect(txt).toBe(
      '# Meeting Transcript: meeting_20260609_134949\n' +
        '# Generated: 2026-06-09 14:10:35\n' +
        '='.repeat(60) +
        '\n\n' +
        '[00:00:00] You:\n' +
        'line one\n\n' +
        '[00:00:59] Other:\n' +
        'line two\n\n'
    )
  })
})

describe('buildTranscriptJson — matches json.dump(indent=2)', () => {
  it('renders integer-valued time as N.0 and indents with 2 spaces', () => {
    const entries: TranscriptEntry[] = [{ time: 0, speaker: 'You', text: 'hi' }]
    expect(buildTranscriptJson(entries)).toBe(
      '[\n  {\n    "time": 0.0,\n    "speaker": "You",\n    "text": "hi"\n  }\n]'
    )
  })

  it('keeps non-integer floats verbatim', () => {
    const entries: TranscriptEntry[] = [{ time: 59.81460317460318, speaker: 'Other', text: 'x' }]
    expect(buildTranscriptJson(entries)).toContain('"time": 59.81460317460318')
  })

  it('escapes non-ASCII like ensure_ascii=True, and escapes newlines', () => {
    const entries: TranscriptEntry[] = [{ time: 1, speaker: 'You', text: 'café\nné' }]
    const out = buildTranscriptJson(entries)
    expect(out).toContain('"text": "caf\\u00e9\\nn\\u00e9"')
  })

  it('empty array renders as []', () => {
    expect(buildTranscriptJson([])).toBe('[]')
  })
})
