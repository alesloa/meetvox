import { describe, test, expect } from 'vitest'
import {
  buildSummaryPrompt,
  needsMapReduce,
  chunkTranscript,
  SUMMARY_CHAR_BUDGET,
} from './prompt'
import type { TranscriptEntry } from '@shared/types'

// ── buildSummaryPrompt ───────────────────────────────────────────────────────

describe('buildSummaryPrompt', () => {
  const entries: TranscriptEntry[] = [
    { time: 0, speaker: 'You', text: 'hi' },
    { time: 1, speaker: 'Other', text: 'yo' },
  ]

  test('contains instruction text', () => {
    const result = buildSummaryPrompt(entries, 'Summarize.')
    expect(result).toContain('Summarize.')
  })

  test('contains formatted transcript lines', () => {
    const result = buildSummaryPrompt(entries, 'Summarize.')
    expect(result).toContain('You: hi')
    expect(result).toContain('Other: yo')
  })

  test('instruction appears before transcript', () => {
    const result = buildSummaryPrompt(entries, 'Summarize.')
    expect(result.indexOf('Summarize.')).toBeLessThan(result.indexOf('You: hi'))
    expect(result.indexOf('You: hi')).toBeLessThan(result.indexOf('Other: yo'))
  })

  test('preserves speaker labels as-is', () => {
    const custom: TranscriptEntry[] = [
      { time: 0, speaker: 'Speaker A', text: 'hello' },
    ]
    expect(buildSummaryPrompt(custom, 'Do it.')).toContain('Speaker A: hello')
  })
})

// ── needsMapReduce ───────────────────────────────────────────────────────────

describe('needsMapReduce', () => {
  test('true when text exceeds budget by 1', () => {
    expect(needsMapReduce('x'.repeat(SUMMARY_CHAR_BUDGET + 1))).toBe(true)
  })

  test('false for short text', () => {
    expect(needsMapReduce('short')).toBe(false)
  })

  test('false when exactly at budget', () => {
    expect(needsMapReduce('x'.repeat(SUMMARY_CHAR_BUDGET))).toBe(false)
  })

  test('respects explicit budget parameter', () => {
    expect(needsMapReduce('hello world', 5)).toBe(true)
    expect(needsMapReduce('hi', 5)).toBe(false)
  })
})

// ── chunkTranscript ──────────────────────────────────────────────────────────

describe('chunkTranscript', () => {
  /** Build N entries each with rendered length exactly `lineLen`. */
  function makeEntries(count: number, lineLen: number): TranscriptEntry[] {
    return Array.from({ length: count }, (_, i) => {
      // speaker = 'S', text fills to make `S: <text>` exactly lineLen chars
      const textLen = lineLen - 'S: '.length
      return { time: i, speaker: 'S', text: 'x'.repeat(Math.max(0, textLen)) }
    })
  }

  test('single chunk when total under budget', () => {
    const entries = makeEntries(3, 5) // 3 × 5 = 15 < 20
    const chunks = chunkTranscript(entries, 20)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toHaveLength(3)
  })

  test('splits into multiple groups with tiny budget', () => {
    // Each entry renders as "S: xx" = 6 chars; budget = 10 → 1 entry per chunk
    // (second entry would push to 12 > 10)
    const entries = makeEntries(4, 6)
    const chunks = chunkTranscript(entries, 10)
    expect(chunks.length).toBeGreaterThan(1)
  })

  test('concatenation preserves all entries in original order', () => {
    const entries = makeEntries(10, 8) // budget = 20 → ~2 per chunk
    const chunks = chunkTranscript(entries, 20)
    const flat = chunks.flat()
    expect(flat).toHaveLength(entries.length)
    flat.forEach((e, i) => expect(e.time).toBe(entries[i].time))
  })

  test('oversized single entry goes in its own group', () => {
    const big: TranscriptEntry = { time: 0, speaker: 'S', text: 'x'.repeat(100) }
    const small: TranscriptEntry = { time: 1, speaker: 'S', text: 'y' }
    const chunks = chunkTranscript([big, small], 10)
    // big entry alone first, then small
    expect(chunks[0]).toContain(big)
    expect(chunks.flat()).toHaveLength(2)
  })

  test('empty input returns empty array', () => {
    expect(chunkTranscript([])).toEqual([])
  })

  test('each chunk rendered with newlines stays within budget', () => {
    // No single entry exceeds the budget, so every chunk must fit once joined.
    const entries = makeEntries(20, 6) // "S: xxx" = 6 chars each
    const budget = 25
    for (const chunk of chunkTranscript(entries, budget)) {
      const rendered = chunk.map((e) => `${e.speaker}: ${e.text}`).join('\n')
      expect(rendered.length).toBeLessThanOrEqual(budget)
    }
  })
})
