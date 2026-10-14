import { describe, it, expect, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import type { MeetingMenuInput } from '@shared/types'
import { buildMeetingMenuTemplate } from './meetingMenu'

const MEETING: MeetingMenuInput = {
  dir: '/rec/meeting_20261013_142414',
  hasTranscript: false,
  transcription: 'idle'
}

function build(input: Partial<MeetingMenuInput> = {}, isMac = true) {
  const pick = vi.fn()
  const reveal = vi.fn()
  const items = buildMeetingMenuTemplate({ ...MEETING, ...input }, isMac, { pick, reveal })
  return { items, pick, reveal }
}

function labels(items: MenuItemConstructorOptions[]): string[] {
  return items.map((i) => (i.type === 'separator' ? '---' : (i.label as string)))
}

function item(items: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions {
  const found = items.find((i) => i.label === label)
  if (!found) throw new Error(`no "${label}" in ${labels(items).join(', ')}`)
  return found
}

function click(i: MenuItemConstructorOptions): void {
  i.click?.(null as never, undefined, null as never)
}

describe('buildMeetingMenuTemplate', () => {
  it('lists the meeting actions, with Delete last on its own', () => {
    expect(labels(build().items)).toEqual([
      'Open',
      'Rename…',
      'Transcribe',
      '---',
      'Show in Finder',
      'Export Transcript',
      '---',
      'Delete…'
    ])
  })

  it('says File Explorer on Windows', () => {
    expect(labels(build({}, false).items)).toContain('Show in File Explorer')
  })

  it('picks the clicked action', () => {
    const { items, pick } = build()
    click(item(items, 'Open'))
    click(item(items, 'Rename…'))
    click(item(items, 'Transcribe'))
    click(item(items, 'Delete…'))
    expect(pick.mock.calls).toEqual([
      [{ kind: 'open' }],
      [{ kind: 'rename' }],
      [{ kind: 'transcribe', mode: 'fresh' }],
      [{ kind: 'delete' }]
    ])
  })

  it('shows the folder from main without picking anything', () => {
    const { items, pick, reveal } = build()
    click(item(items, 'Show in Finder'))
    expect(reveal).toHaveBeenCalledOnce()
    expect(pick).not.toHaveBeenCalled()
  })

  it('exports only a meeting that has a transcript', () => {
    expect(item(build().items, 'Export Transcript').enabled).toBe(false)

    const { items, pick } = build({ hasTranscript: true })
    const exportItem = item(items, 'Export Transcript')
    expect(exportItem.enabled).toBe(true)
    const formats = exportItem.submenu as MenuItemConstructorOptions[]
    expect(labels(formats)).toEqual(['Markdown', 'Plain Text', 'SRT'])
    formats.forEach(click)
    expect(pick.mock.calls).toEqual([
      [{ kind: 'export', format: 'md' }],
      [{ kind: 'export', format: 'txt' }],
      [{ kind: 'export', format: 'srt' }]
    ])
  })

  it('leaves out Transcribe once the meeting has a transcript', () => {
    expect(labels(build({ hasTranscript: true }).items)).toEqual([
      'Open',
      'Rename…',
      '---',
      'Show in Finder',
      'Export Transcript',
      '---',
      'Delete…'
    ])
  })

  it('offers Continue for a stopped transcription', () => {
    const { items, pick } = build({ transcription: 'stopped' })
    click(item(items, 'Continue Transcribing'))
    expect(pick).toHaveBeenCalledWith({ kind: 'transcribe', mode: 'continue' })
  })

  it('offers Stop while this meeting transcribes, and keeps it from being deleted', () => {
    const { items, pick } = build({ transcription: 'running' })
    click(item(items, 'Stop Transcribing'))
    expect(pick).toHaveBeenCalledWith({ kind: 'stop' })
    expect(item(items, 'Delete…').enabled).toBe(false)
  })

  it('greys out Transcribe while another meeting transcribes', () => {
    const { items } = build({ transcription: 'busy' })
    expect(item(items, 'Transcribe').enabled).toBe(false)
    expect(item(items, 'Delete…').enabled).not.toBe(false)
  })
})
