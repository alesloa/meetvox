import { describe, it, expect, vi } from 'vitest'
import { buildTrayMenuTemplate } from './tray'

function labels(items: ReturnType<typeof buildTrayMenuTemplate>): string[] {
  return items.map((i) => (i.type === 'separator' ? '---' : (i.label as string)))
}

// Fresh handler mocks per test so click-counts never leak between cases.
function makeHandlers(): {
  open: ReturnType<typeof vi.fn>
  startRecording: ReturnType<typeof vi.fn>
  stopRecording: ReturnType<typeof vi.fn>
  settings: ReturnType<typeof vi.fn>
  quit: ReturnType<typeof vi.fn>
} {
  return {
    open: vi.fn(),
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    settings: vi.fn(),
    quit: vi.fn()
  }
}

describe('buildTrayMenuTemplate — record label tracks recording state', () => {
  it('shows Start Recording when idle', () => {
    const items = buildTrayMenuTemplate(false, makeHandlers())
    expect(labels(items)).toEqual([
      'Open Meetvox',
      '---',
      'Start Recording',
      'Settings…',
      '---',
      'Quit Meetvox'
    ])
  })

  it('shows Stop Recording when recording', () => {
    const items = buildTrayMenuTemplate(true, makeHandlers())
    expect(labels(items)).toContain('Stop Recording')
    expect(labels(items)).not.toContain('Start Recording')
  })

  it('wires the record item to the matching handler for the current state', () => {
    const handlers = makeHandlers()

    const idle = buildTrayMenuTemplate(false, handlers)
    const startItem = idle.find((i) => i.label === 'Start Recording')
    startItem?.click?.(null as never, undefined, null as never)
    expect(handlers.startRecording).toHaveBeenCalledOnce()
    expect(handlers.stopRecording).not.toHaveBeenCalled()

    const recording = buildTrayMenuTemplate(true, handlers)
    const stopItem = recording.find((i) => i.label === 'Stop Recording')
    stopItem?.click?.(null as never, undefined, null as never)
    expect(handlers.stopRecording).toHaveBeenCalledOnce()
  })

  it('wires Open / Settings / Quit handlers', () => {
    const handlers = makeHandlers()
    const items = buildTrayMenuTemplate(false, handlers)
    const click = (label: string): void =>
      void items.find((i) => i.label === label)?.click?.(null as never, undefined, null as never)

    click('Open Meetvox')
    click('Settings…')
    click('Quit Meetvox')
    expect(handlers.open).toHaveBeenCalledOnce()
    expect(handlers.settings).toHaveBeenCalledOnce()
    expect(handlers.quit).toHaveBeenCalledOnce()
  })
})
