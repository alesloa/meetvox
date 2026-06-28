import { describe, it, expect, vi } from 'vitest'
import { canSend, safeSend } from './safeSend'
import type { BrowserWindow } from 'electron'

// A minimal BrowserWindow stand-in: only the two liveness predicates + the
// webContents.send used by safeSend. Cast through unknown so the fakes satisfy
// the real type without dragging in Electron.
function fakeWindow(winDestroyed: boolean, wcDestroyed: boolean): BrowserWindow {
  return {
    isDestroyed: () => winDestroyed,
    webContents: {
      isDestroyed: () => wcDestroyed,
      send: vi.fn()
    }
  } as unknown as BrowserWindow
}

describe('canSend — only a live window + live webContents may receive', () => {
  it('false for null (window closed and reference dropped)', () => {
    expect(canSend(null)).toBe(false)
  })

  it('false for a destroyed window WITHOUT touching webContents', () => {
    // A destroyed BrowserWindow is still a truthy object — `win?.webContents`
    // is not enough. And reading webContents on a destroyed window must be
    // avoided, so isDestroyed() has to short-circuit first.
    const win = {
      isDestroyed: () => true,
      get webContents(): never {
        throw new Error('must not read webContents on a destroyed window')
      }
    } as unknown as BrowserWindow
    expect(canSend(win)).toBe(false)
  })

  it('false when the window is alive but webContents is destroyed', () => {
    expect(canSend(fakeWindow(false, true))).toBe(false)
  })

  it('true when both window and webContents are alive', () => {
    expect(canSend(fakeWindow(false, false))).toBe(true)
  })
})

describe('safeSend — guards the renderer send', () => {
  it('sends when the window can receive', () => {
    const win = fakeWindow(false, false)
    safeSend(win, 'levels', { mic: 1, system: 0 })
    expect(win.webContents.send).toHaveBeenCalledWith('levels', { mic: 1, system: 0 })
  })

  it('no-ops on null (the destroyed-window crash path)', () => {
    expect(() => safeSend(null, 'levels', { mic: 1, system: 0 })).not.toThrow()
  })

  it('does not send to a window whose webContents is destroyed', () => {
    const win = fakeWindow(false, true)
    safeSend(win, 'levels', { mic: 1, system: 0 })
    expect(win.webContents.send).not.toHaveBeenCalled()
  })
})
