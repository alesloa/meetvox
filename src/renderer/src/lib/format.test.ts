import { fmtClock, fmtDuration, fmtDate, fmtMeetingTime, groupByRecency } from './format'

describe('fmtClock', () => {
  test('zero → 00:00:00', () => {
    expect(fmtClock(0)).toBe('00:00:00')
  })
  test('pads minutes and seconds', () => {
    expect(fmtClock(65)).toBe('00:01:05')
  })
  test('full HH:MM:SS', () => {
    expect(fmtClock(3725)).toBe('01:02:05')
  })
  test('floors fractional seconds', () => {
    expect(fmtClock(3725.9)).toBe('01:02:05')
  })
  test('clamps negatives to zero', () => {
    expect(fmtClock(-5)).toBe('00:00:00')
  })
})

describe('fmtDuration', () => {
  test('zero → 0:00', () => {
    expect(fmtDuration(0)).toBe('0:00')
  })
  test('sub-minute → 0:SS', () => {
    expect(fmtDuration(9)).toBe('0:09')
  })
  test('minutes:seconds', () => {
    expect(fmtDuration(90)).toBe('1:30')
  })
  test('drops hour when under an hour', () => {
    expect(fmtDuration(605)).toBe('10:05')
  })
  test('hours:minutes:seconds when ≥ 1h', () => {
    expect(fmtDuration(3725)).toBe('1:02:05')
  })
  test('floors fractional seconds', () => {
    expect(fmtDuration(90.7)).toBe('1:30')
  })
  test('clamps negatives to zero', () => {
    expect(fmtDuration(-1)).toBe('0:00')
  })
})

describe('fmtDate', () => {
  test('returns a non-empty string containing the year for a valid ISO date', () => {
    const out = fmtDate('2026-06-09T14:30:00.000Z')
    expect(typeof out).toBe('string')
    expect(out.length).toBeGreaterThan(0)
    // Locale-independent sanity: the 4-digit year is present in every locale's output.
    expect(out).toMatch(/2026/)
  })
  test('does not throw on a valid ISO date', () => {
    expect(() => fmtDate('2026-01-01T00:00:00Z')).not.toThrow()
  })
  test('returns empty string for an invalid date', () => {
    expect(fmtDate('not-a-date')).toBe('')
  })
  test('returns empty string for an empty input', () => {
    expect(fmtDate('')).toBe('')
  })
})

describe('fmtMeetingTime', () => {
  test('returns a compact string WITHOUT the year for a valid ISO date', () => {
    const out = fmtMeetingTime('2026-06-09T14:30:00.000Z')
    expect(out.length).toBeGreaterThan(0)
    expect(out).not.toMatch(/2026/)
  })
  test('returns empty string for invalid/empty input', () => {
    expect(fmtMeetingTime('not-a-date')).toBe('')
    expect(fmtMeetingTime('')).toBe('')
  })
})

describe('groupByRecency', () => {
  // Local noon on Wed Jun 10 2026. Items built with the local Date constructor so
  // the "today/yesterday" windows line up with local midnight regardless of TZ.
  const now = new Date(2026, 5, 10, 12, 0, 0)
  const at = (y: number, mo: number, d: number, h = 9): { createdAt: string } => ({
    createdAt: new Date(y, mo, d, h, 0, 0).toISOString()
  })

  test('labels and orders the standard buckets newest-first', () => {
    const groups = groupByRecency(
      [
        at(2026, 5, 10), // today
        at(2026, 5, 9), // yesterday
        at(2026, 5, 6), // 4 days ago → Previous 7 Days
        at(2026, 4, 21), // ~20 days ago → Previous 30 Days
        at(2026, 2, 12) // March 2026
      ],
      now
    )
    expect(groups.map((g) => g.label)).toEqual([
      'Today',
      'Yesterday',
      'Previous 7 Days',
      'Previous 30 Days',
      'March 2026'
    ])
  })

  test('omits empty buckets', () => {
    const groups = groupByRecency([at(2026, 5, 10)], now)
    expect(groups).toHaveLength(1)
    expect(groups[0].key).toBe('today')
  })

  test('sorts items within a group newest-first', () => {
    const early = at(2026, 5, 10, 8)
    const late = at(2026, 5, 10, 17)
    const groups = groupByRecency([early, late], now)
    expect(groups[0].items[0]).toBe(late)
    expect(groups[0].items[1]).toBe(early)
  })

  test('buckets older meetings by calendar month', () => {
    const groups = groupByRecency([at(2026, 2, 12), at(2026, 2, 3), at(2026, 1, 20)], now)
    expect(groups.map((g) => g.label)).toEqual(['March 2026', 'February 2026'])
    expect(groups[0].items).toHaveLength(2)
  })

  test('puts an invalid createdAt in an Unknown bucket, ordered last', () => {
    const groups = groupByRecency([{ createdAt: 'nonsense' }, at(2026, 5, 10)], now)
    expect(groups[0].label).toBe('Today')
    expect(groups[groups.length - 1].label).toBe('Unknown date')
  })
})
