import { describe, test, expect } from 'vitest'
import { parseMeta, defaultMetaFromFolder } from './meta'

describe('defaultMetaFromFolder', () => {
  test('default meta derived from folder name', () => {
    const m = defaultMetaFromFolder('/r/meeting_20260609_134949', { durationSec: 90 })
    expect(m.name).toBe('Meeting 2026-06-09 13:49')
    // createdAt represents the folder digits as LOCAL wall-clock time, so its local
    // components round-trip back to the digits regardless of the test machine's TZ.
    // (Asserting the literal "...Z" string would only hold in UTC and was the bug.)
    const d = new Date(m.createdAt)
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 5, 9])
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([13, 49, 49])
    expect(m.source).toBe('recorded')
    expect(m.channelMapped).toBe(true)
  })

  test('durationSec comes from opts', () => {
    const m = defaultMetaFromFolder('/r/meeting_20260101_000000', { durationSec: 42 })
    expect(m.durationSec).toBe(42)
  })
})

describe('parseMeta', () => {
  test('tolerates missing fields', () => {
    expect(parseMeta('{"name":"X","createdAt":"2026-01-01T00:00:00.000Z"}').source).toBe('recorded')
  })

  test('fills defaults for all optional fields', () => {
    const m = parseMeta('{}')
    expect(m.source).toBe('recorded')
    expect(m.durationSec).toBe(0)
    expect(m.channelMapped).toBe(true)
  })

  test('preserves existing values', () => {
    const m = parseMeta('{"name":"X","createdAt":"2026-01-01T00:00:00.000Z","source":"imported","durationSec":99,"channelMapped":false}')
    expect(m.source).toBe('imported')
    expect(m.durationSec).toBe(99)
    expect(m.channelMapped).toBe(false)
  })
})
