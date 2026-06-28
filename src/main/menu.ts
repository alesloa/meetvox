// Application menu — the macOS top menu bar (and the Windows/Linux window menu).
//
// Without an explicit menu, Electron installs its DEFAULT template: the bold app
// menu shows the running bundle's name ("Electron" in a dev run, since the binary
// is Electron's own .app) and the File menu holds only "Close Window". That is the
// "it says Electron / File is empty" bug. This builds a real Meetvox menu with
// working New Recording / Import / Open-Recordings-Folder / Settings items, reusing
// the SAME trayNavigate/trayAction renderer channels the tray already drives — no
// new IPC, no duplicated record/import logic. The bold title comes from `appName`
// (index.ts calls app.setName('Meetvox') before this runs), which is also what makes
// the packaged build's productName line up dev↔packaged.

import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { Events } from '@shared/ipc'
import type { AppContext } from './context'
import { safeSend } from './safeSend'

export interface AppMenuHandlers {
  newRecording: () => void
  importAudio: () => void
  openRecordingsFolder: () => void
  settings: () => void
}

/**
 * Pure template builder — no Electron side effects, so the menu shape can be
 * unit-tested the same way buildTrayMenuTemplate is. `appName` becomes the bold
 * macOS app-menu title; `isMac` swaps the platform-specific roles (mac gets a
 * dedicated app menu, Win/Linux fold Settings + Quit into File).
 */
export function buildAppMenuTemplate(
  isMac: boolean,
  appName: string,
  handlers: AppMenuHandlers
): MenuItemConstructorOptions[] {
  const fileSubmenu: MenuItemConstructorOptions[] = [
    { label: 'New Recording', accelerator: 'CmdOrCtrl+N', click: handlers.newRecording },
    { label: 'Import Audio…', accelerator: 'CmdOrCtrl+O', click: handlers.importAudio },
    { type: 'separator' },
    { label: 'Open Recordings Folder', click: handlers.openRecordingsFolder }
  ]
  if (isMac) {
    fileSubmenu.push({ type: 'separator' }, { role: 'close' })
  } else {
    // No app menu on Win/Linux, so Settings + Quit live in File.
    fileSubmenu.push(
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'Ctrl+,', click: handlers.settings },
      { type: 'separator' },
      { role: 'quit' }
    )
  }

  const template: MenuItemConstructorOptions[] = []

  if (isMac) {
    template.push({
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Settings…', accelerator: 'Cmd+,', click: handlers.settings },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }

  template.push(
    { label: 'File', submenu: fileSubmenu },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: isMac
        ? [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
        : [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }]
    }
  )

  return template
}

/**
 * Build the live application menu and install it. Wires the custom File items to
 * the renderer via the existing tray channels (trayAction 'start' reuses HomeView's
 * record handler; trayNavigate routes to the import/settings views) and opens the
 * recordings folder straight from main. `show` focuses-or-creates the window so a
 * menu click works even after the window was closed to the tray.
 */
export function installAppMenu(
  ctx: AppContext,
  getWindow: () => BrowserWindow | null,
  show: () => void
): void {
  const send = (channel: string, payload: unknown): void => safeSend(getWindow(), channel, payload)

  const template = buildAppMenuTemplate(process.platform === 'darwin', app.name, {
    // Recording needs the renderer's device selection + monitor→recorder handoff,
    // so never start from main: focus the window and let HomeView's start handler
    // run via trayAction 'start' (guarded there on !recording).
    newRecording: () => {
      show()
      send(Events.trayAction, 'start')
    },
    importAudio: () => {
      show()
      send(Events.trayNavigate, 'import')
    },
    openRecordingsFolder: () => {
      void shell.openPath(ctx.recordingsRoot)
    },
    settings: () => {
      show()
      send(Events.trayNavigate, 'settings')
    }
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
