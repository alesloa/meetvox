// Pure time/date formatters shared across the meeting-library + detail UI.
// No side-effects, no IPC — safe to unit-test in isolation.

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** Whole, non-negative seconds. Floors fractions, clamps negatives to 0. */
function clampSec(sec: number): number {
  if (!Number.isFinite(sec) || sec <= 0) return 0
  return Math.floor(sec)
}

/** Download size in decimal units, e.g. 1_624_555_275 → '1.62 GB', 574_041_195 → '574 MB'. */
export function fmtBytes(n: number): string {
  return n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${Math.round(n / 1e6)} MB`
}

/** `HH:MM:SS`, always zero-padded. e.g. 0 → '00:00:00', 3725 → '01:02:05'. */
export function fmtClock(sec: number): string {
  const total = clampSec(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`
}

/**
 * Compact human duration: `M:SS` under an hour, `H:MM:SS` at/above an hour.
 * e.g. 0 → '0:00', 90 → '1:30', 3725 → '1:02:05'.
 */
export function fmtDuration(sec: number): string {
  const total = clampSec(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${pad2(m)}:${pad2(s)}`
  return `${m}:${pad2(s)}`
}

/**
 * Readable local date+time from an ISO string. Returns '' on an invalid/empty
 * input rather than throwing or rendering 'Invalid Date'.
 */
export function fmtDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * Compact date+time for a sidebar meeting row: `Mon D, HH:MM` (no year). The
 * surrounding recency group already conveys roughly when, so the year is dropped
 * to keep rows short. '' on invalid/empty input.
 */
export function fmtMeetingTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const MS_DAY = 86_400_000

export interface RecencyGroup<T> {
  key: string // stable id for collapse state (e.g. 'today', '2026-2')
  label: string // 'Today' | 'Yesterday' | 'Previous 7 Days' | 'March 2026' | …
  items: T[]
}

/** Local midnight of the given date (does not mutate the input). */
function startOfDay(d: Date): Date {
  const x = new Date(d.getTime())
  x.setHours(0, 0, 0, 0)
  return x
}

/** Which recency bucket an ISO timestamp falls into, relative to `now`. */
function bucketFor(iso: string, now: Date): { key: string; label: string; order: number } {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return { key: 'unknown', label: 'Unknown date', order: 999 }

  const today = startOfDay(now).getTime()
  if (t >= today) return { key: 'today', label: 'Today', order: 0 }
  if (t >= today - MS_DAY) return { key: 'yesterday', label: 'Yesterday', order: 1 }
  if (t >= today - 7 * MS_DAY) return { key: 'prev7', label: 'Previous 7 Days', order: 2 }
  if (t >= today - 30 * MS_DAY) return { key: 'prev30', label: 'Previous 30 Days', order: 3 }

  // Older than 30 days → one group per calendar month, newest month first.
  const d = new Date(t)
  const monthsAgo = now.getFullYear() * 12 + now.getMonth() - (d.getFullYear() * 12 + d.getMonth())
  return {
    key: `${d.getFullYear()}-${d.getMonth()}`,
    label: d.toLocaleString(undefined, { month: 'long', year: 'numeric' }),
    order: 4 + Math.max(1, monthsAgo)
  }
}

/**
 * Group meetings (anything with an ISO `createdAt`) into ordered recency buckets:
 * Today, Yesterday, Previous 7 Days, Previous 30 Days, then one group per older
 * calendar month. Items inside each group are sorted newest-first. Empty buckets
 * are omitted. Pure — `now` is injected so it is deterministically testable.
 */
export function groupByRecency<T extends { createdAt: string }>(
  items: T[],
  now: Date
): RecencyGroup<T>[] {
  const byKey = new Map<string, { label: string; order: number; items: T[] }>()
  for (const item of items) {
    const b = bucketFor(item.createdAt, now)
    const g = byKey.get(b.key) ?? { label: b.label, order: b.order, items: [] }
    g.items.push(item)
    byKey.set(b.key, g)
  }
  return [...byKey.entries()]
    .map(([key, g]) => ({
      key,
      label: g.label,
      order: g.order,
      items: g.items.sort((a, z) => z.createdAt.localeCompare(a.createdAt))
    }))
    .sort((a, z) => a.order - z.order)
    .map(({ key, label, items }) => ({ key, label, items }))
}
