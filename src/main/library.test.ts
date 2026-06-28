import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { listMeetings, getMeeting, renameMeeting, deleteMeeting } from './library'

let tmpRoot: string

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'meetvox-'))
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

function makeMeetingDir(root: string, name: string): string {
  const dir = join(root, name)
  mkdirSync(dir)
  return dir
}

describe('listMeetings', () => {
  test('lists newest first and backfills meta', async () => {
    // Older meeting — no meta.json
    makeMeetingDir(tmpRoot, 'meeting_20260601_100000')
    // Newer meeting — with meta.json
    const newer = makeMeetingDir(tmpRoot, 'meeting_20260609_134949')
    writeFileSync(
      join(newer, 'meta.json'),
      JSON.stringify({ name: 'Pre-existing', createdAt: '2026-06-09T13:49:49.000Z', source: 'recorded', durationSec: 10, channelMapped: true })
    )

    const list = await listMeetings(tmpRoot)
    expect(list).toHaveLength(2)
    // Newest first
    expect(list[0].createdAt >= list[1].createdAt).toBe(true)
    // meta.json was backfilled for the older folder
    expect(existsSync(join(list[1].dir, 'meta.json'))).toBe(true)
  })

  test('heals a recorded createdAt that was local digits mislabeled as UTC', async () => {
    const dir = makeMeetingDir(tmpRoot, 'meeting_20260610_042600')
    // Legacy bug: the local wall-clock digits (04:26) were stamped with a literal Z.
    writeFileSync(
      join(dir, 'meta.json'),
      JSON.stringify({
        name: 'My renamed meeting',
        createdAt: '2026-06-10T04:26:00.000Z',
        source: 'recorded',
        durationSec: 5,
        channelMapped: true
      })
    )

    const [m] = await listMeetings(tmpRoot)
    // createdAt now represents LOCAL 2026-06-10 04:26:00 (the folder digits),
    // regardless of the test machine's timezone.
    const d = new Date(m.createdAt)
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 5, 10])
    expect([d.getHours(), d.getMinutes()]).toEqual([4, 26])
    // The user's rename survives the heal.
    expect(m.name).toBe('My renamed meeting')
  })

  test('does not rewrite an imported meeting (its createdAt is already correct)', async () => {
    const dir = makeMeetingDir(tmpRoot, 'meeting_20260610_042600')
    const imported = {
      name: 'Imported recording',
      createdAt: '2026-06-10T04:26:00.000Z',
      source: 'imported',
      durationSec: 5,
      channelMapped: false
    }
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(imported))

    const [m] = await listMeetings(tmpRoot)
    expect(m.createdAt).toBe('2026-06-10T04:26:00.000Z') // untouched
    expect(m.name).toBe('Imported recording')
  })

  test('ignores non-meeting entries', async () => {
    mkdirSync(join(tmpRoot, 'other_folder'))
    writeFileSync(join(tmpRoot, 'somefile.txt'), '')
    makeMeetingDir(tmpRoot, 'meeting_20260609_090000')
    const list = await listMeetings(tmpRoot)
    expect(list).toHaveLength(1)
  })

  test('sets hasTranscript true when transcript.json present', async () => {
    const dir = makeMeetingDir(tmpRoot, 'meeting_20260609_120000')
    writeFileSync(join(dir, 'transcript.json'), '[]')
    const list = await listMeetings(tmpRoot)
    expect(list[0].hasTranscript).toBe(true)
  })

  test('sets hasSummary true when summary.json present', async () => {
    const dir = makeMeetingDir(tmpRoot, 'meeting_20260609_120001')
    writeFileSync(join(dir, 'summary.json'), '{}')
    const list = await listMeetings(tmpRoot)
    expect(list[0].hasSummary).toBe(true)
  })

  test('returns empty array when root does not exist', async () => {
    const list = await listMeetings(join(tmpRoot, 'nonexistent'))
    expect(list).toEqual([])
  })

  test('skips an unreadable meeting folder instead of crashing the whole list', async () => {
    // Good folders.
    makeMeetingDir(tmpRoot, 'meeting_20260601_100000')
    makeMeetingDir(tmpRoot, 'meeting_20260602_100000')
    // Bad folder: meta.json is a DIRECTORY, so readFileSync throws EISDIR.
    const bad = makeMeetingDir(tmpRoot, 'meeting_20260603_100000')
    mkdirSync(join(bad, 'meta.json'))

    const list = await listMeetings(tmpRoot)
    // The two good meetings survive; the unreadable one is skipped, no throw.
    expect(list).toHaveLength(2)
    expect(list.some((m) => m.dir === bad)).toBe(false)
  })
})

describe('getMeeting', () => {
  test('returns meeting and empty entries when no transcript', async () => {
    const dir = makeMeetingDir(tmpRoot, 'meeting_20260609_100000')
    const { meeting, entries } = await getMeeting(dir)
    expect(meeting.dir).toBe(dir)
    expect(entries).toEqual([])
  })

  test('parses transcript.json entries', async () => {
    const dir = makeMeetingDir(tmpRoot, 'meeting_20260609_110000')
    const data = [{ time: 0, speaker: 'You', text: 'hello' }]
    writeFileSync(join(dir, 'transcript.json'), JSON.stringify(data))
    const { entries } = await getMeeting(dir)
    expect(entries).toEqual(data)
  })
})

describe('renameMeeting', () => {
  test('round-trip: rename then re-list shows new name, folder unchanged', async () => {
    const dir = makeMeetingDir(tmpRoot, 'meeting_20260609_134949')
    await renameMeeting(dir, 'Standup')
    const list = await listMeetings(tmpRoot)
    expect(list[0].name).toBe('Standup')
    expect(list[0].dir).toBe(dir)
  })

  test('rejects empty name', async () => {
    const dir = makeMeetingDir(tmpRoot, 'meeting_20260609_134949')
    await expect(renameMeeting(dir, '   ')).rejects.toThrow()
  })

  test('rejects empty string', async () => {
    const dir = makeMeetingDir(tmpRoot, 'meeting_20260609_134949')
    await expect(renameMeeting(dir, '')).rejects.toThrow()
  })
})

describe('deleteMeeting', () => {
  test('folder gone after delete', async () => {
    const dir = makeMeetingDir(tmpRoot, 'meeting_20260609_134949')
    expect(existsSync(dir)).toBe(true)
    await deleteMeeting(dir, tmpRoot)
    expect(existsSync(dir)).toBe(false)
  })

  test('rejects path outside root', async () => {
    const dir = makeMeetingDir(tmpRoot, 'meeting_20260609_134949')
    const otherRoot = mkdtempSync(join(tmpdir(), 'meetvox-other-'))
    try {
      await expect(deleteMeeting(dir, otherRoot)).rejects.toThrow()
    } finally {
      rmSync(otherRoot, { recursive: true, force: true })
    }
  })

  test('rejects path with non-meeting basename', async () => {
    const dir = mkdtempSync(join(tmpRoot, 'notameeting-'))
    await expect(deleteMeeting(dir, tmpRoot)).rejects.toThrow()
  })
})
