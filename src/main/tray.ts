// System tray / macOS menu-bar control. Builds a Tray from the monochrome
// template image, shows a context menu whose record label is kept in sync with
// the shared Recorder's status, and routes tray clicks to the window / renderer.
//
// The menu is rebuilt on every recorder 'status' event so the Start/Stop item
// matches the live recording state. The Tray instance MUST be retained by the
// caller (index.ts holds it in a module variable) so it is not garbage-collected.

import {
  app,
  Menu,
  Tray,
  nativeImage,
  BrowserWindow,
  type MenuItemConstructorOptions
} from 'electron'
import { join } from 'path'
import { Events } from '@shared/ipc'
import type { AppContext } from './context'
import { safeSend } from './safeSend'

/** Tray PNGs ship alongside the binaries; resolve dev vs packaged the same way. */
function trayImagePath(): string {
  // Dev: <repoRoot>/build/tray-Template.png (app.getAppPath() = repo root).
  // Packaged: shipped via electron-builder extraResources to <resourcesPath>/build/.
  const base = app.isPackaged ? join(process.resourcesPath, 'build') : join(app.getAppPath(), 'build')
  return join(base, 'tray-Template.png')
}

/**
 * Pure menu template builder. Kept separate from createTray so the recording-aware
 * labels/visibility can be unit-tested without an Electron Tray. `isRecording`
 * comes straight from `ctx.recorder.isRecording()`. Click handlers are injected so
 * this stays free of Electron/window side effects.
 */
export function buildTrayMenuTemplate(
  isRecording: boolean,
  handlers: {
    open: () => void
    startRecording: () => void
    stopRecording: () => void
    settings: () => void
    quit: () => void
  }
): MenuItemConstructorOptions[] {
  return [
    { label: 'Open Meetvox', click: handlers.open },
    { type: 'separator' },
    isRecording
      ? { label: 'Stop Recording', click: handlers.stopRecording }
      : { label: 'Start Recording', click: handlers.startRecording },
    { label: 'Settings…', click: handlers.settings },
    { type: 'separator' },
    { label: 'Quit Meetvox', click: handlers.quit }
  ]
}

/**
 * Create the tray icon + menu and wire it to the window and recorder.
 *
 * @param ctx      app context (uses ctx.recorder for status + stop()).
 * @param getWindow returns the current window, or null if it has been closed.
 * @param show     show-or-create helper: focuses the existing window, or creates one.
 */
export function createTray(
  ctx: AppContext,
  getWindow: () => BrowserWindow | null,
  show: () => void
): Tray {
  const img = nativeImage.createFromPath(trayImagePath())
  // macOS auto-tints a Template image for light/dark menu bars. No-op on Windows.
  if (process.platform === 'darwin') img.setTemplateImage(true)

  const tray = new Tray(img)
  tray.setToolTip('Meetvox')

  const send = (channel: string, payload: unknown): void => safeSend(getWindow(), channel, payload)

  const rebuild = (): void => {
    const template = buildTrayMenuTemplate(ctx.recorder.isRecording(), {
      open: () => show(),
      // Recording needs the renderer's device selection + monitor→recorder handoff,
      // so never start the recorder from main — focus the window and let HomeView's
      // existing start handler run via the trayAction event.
      startRecording: () => {
        show()
        send(Events.trayAction, 'start')
      },
      // Stopping is safe to drive directly: recorder.stop() emits 'saving'→'idle'
      // status events that the IPC layer forwards to the renderer; HomeView derives
      // `recording = status.phase === 'recording'`, so its UI flips to idle on its
      // own. No trayAction needed for stop.
      stopRecording: () => {
        if (ctx.recorder.isRecording()) ctx.recorder.stop().catch(() => {})
      },
      settings: () => {
        show()
        send(Events.trayNavigate, 'settings')
      },
      quit: () => app.quit()
    })
    tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  rebuild()
  // Keep the Start/Stop label in sync with live recording state.
  ctx.recorder.on('status', rebuild)

  return tray
}
