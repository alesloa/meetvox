import { describe, test, expect } from 'vitest'
import { toMarkdown, toPlainText, toSrt } from './export'

const entries = [
  { time: 0, speaker: 'You', text: 'hi' },
  { time: 3.5, speaker: 'Other', text: 'yo' }
]

describe('toSrt', () => {
  test('timecode + indexing exact byte match', () => {
    expect(toSrt(entries)).toBe(
      '1\n00:00:00,000 --> 00:00:03,500\nYou: hi\n\n2\n00:00:03,500 --> 00:00:06,500\nOther: yo\n'
    )
  })

  test('single entry uses start + 3s for end', () => {
    const result = toSrt([{ time: 5, speaker: 'You', text: 'hello' }])
    expect(result).toBe('1\n00:00:05,000 --> 00:00:08,000\nYou: hello\n')
  })

  test('returns empty string for empty entries', () => {
    expect(toSrt([])).toBe('')
  })

  test('millisecond precision in timecode', () => {
    const result = toSrt([
      { time: 1.001, speaker: 'You', text: 'a' },
      { time: 2.999, speaker: 'Other', text: 'b' }
    ])
    expect(result).toContain('00:00:01,001 --> 00:00:02,999')
  })
})

describe('toMarkdown', () => {
  test('contains title header', () => {
    expect(toMarkdown(entries, 'Standup')).toContain('# Standup')
  })

  test('contains bold speaker and text', () => {
    expect(toMarkdown(entries, 'Standup')).toContain('**You:** hi')
  })

  test('contains second speaker', () => {
    expect(toMarkdown(entries, 'Standup')).toContain('**Other:** yo')
  })
})

describe('toPlainText', () => {
  test('formats speaker: text lines', () => {
    const result = toPlainText(entries)
    expect(result).toContain('You: hi')
    expect(result).toContain('Other: yo')
  })

  test('returns empty string for empty entries', () => {
    expect(toPlainText([])).toBe('')
  })
})
