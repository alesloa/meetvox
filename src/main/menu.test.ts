import { describe, it, expect, vi } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { buildAppMenuTemplate, type AppMenuHandlers } from './menu'

function topLabels(items: MenuItemConstructorOptions[]): string[] {
  return items.map((i) => i.label as string)
}

function submenuOf(items: MenuItemConstructorOptions[], label: string): MenuItemConstructorOptions[] {
  const found = items.find((i) => i.label === label)
  return (found?.submenu as MenuItemConstructorOptions[]) ?? []
}

function fileLabels(sub: MenuItemConstructorOptions[]): string[] {
  return sub.map((i) => (i.type === 'separator' ? '---' : ((i.label as string) ?? (i.role as string))))
}

function makeHandlers(): AppMenuHandlers & Record<keyof AppMenuHandlers, ReturnType<typeof vi.fn>> {
  return {
    newRecording: vi.fn(),
    importAudio: vi.fn(),
    openRecordingsFolder: vi.fn(),
    settings: vi.fn()
  }
}

describe('buildAppMenuTemplate', () => {
  it('uses the app name as the bold mac app-menu title (not "Electron")', () => {
    const items = buildAppMenuTemplate(true, 'Meetvox', makeHandlers())
    expect(topLabels(items)[0]).toBe('Meetvox')
    expect(topLabels(items)).not.toContain('Electron')
  })

  it('gives File real items on mac — never an empty/Close-only menu', () => {
    const items = buildAppMenuTemplate(true, 'Meetvox', makeHandlers())
    const file = fileLabels(submenuOf(items, 'File'))
    expect(file).toEqual([
      'New Recording',
      'Import Audio…',
      '---',
      'Open Recordings Folder',
      '---',
      'close'
    ])
  })

  it('folds Settings + Quit into File on Windows (no app menu there)', () => {
    const items = buildAppMenuTemplate(false, 'Meetvox', makeHandlers())
    expect(topLabels(items)).not.toContain('Meetvox') // no dedicated app menu
    const file = fileLabels(submenuOf(items, 'File'))
    expect(file).toContain('Settings…')
    expect(file).toContain('quit')
  })

  it('ships Edit/View/Window menus for textareas, zoom, and window control', () => {
    const items = buildAppMenuTemplate(true, 'Meetvox', makeHandlers())
    const tops = topLabels(items)
    expect(tops).toContain('Edit')
    expect(tops).toContain('View')
    expect(tops).toContain('Window')
  })

  it('wires the File items to their handlers', () => {
    const handlers = makeHandlers()
    const items = buildAppMenuTemplate(true, 'Meetvox', handlers)
    const file = submenuOf(items, 'File')
    const click = (label: string): void =>
      void file.find((i) => i.label === label)?.click?.(null as never, undefined, null as never)

    click('New Recording')
    click('Import Audio…')
    click('Open Recordings Folder')
    expect(handlers.newRecording).toHaveBeenCalledOnce()
    expect(handlers.importAudio).toHaveBeenCalledOnce()
    expect(handlers.openRecordingsFolder).toHaveBeenCalledOnce()
  })

  it('wires Settings from the app menu on mac', () => {
    const handlers = makeHandlers()
    const items = buildAppMenuTemplate(true, 'Meetvox', handlers)
    const appMenu = submenuOf(items, 'Meetvox')
    appMenu.find((i) => i.label === 'Settings…')?.click?.(null as never, undefined, null as never)
    expect(handlers.settings).toHaveBeenCalledOnce()
  })
})
