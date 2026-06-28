// Electron main entry: creates the single Meetvox window and wires the IPC layer.

import { app, BrowserWindow, shell, protocol, Tray, nativeImage } from 'electron'
import { join } from 'path'
import { createContext, type AppContext } from './context'
import { registerIpc } from './ipc'
import { registerAudioProtocol } from './protocol'
import { createTray } from './tray'
import { installAppMenu } from './menu'

// Set BEFORE app is ready so the macOS app menu's bold title reads "Meetvox"
// instead of the dev bundle's "Electron". (Packaged builds also get it from
// electron-builder's productName; this keeps dev and packaged consistent.)
app.setName('Meetvox')

// Must run before app.whenReady: privileges the meetvox-audio scheme so the
// renderer's <audio> can stream it (standard URL parsing, secure, byte-range streaming).
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'meetvox-audio',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true }
  }
])

let mainWindow: BrowserWindow | null = null
// Retain the Tray in a module variable so it isn't garbage-collected (a GC'd Tray
// drops its icon from the menu bar).
let tray: Tray | null = null
// Shared app context (recorder + monitor). Module-level so the window 'closed'
// handler can stop the monitor regardless of which path created the window.
let ctx: AppContext | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100, // Two-pane meeting view needs the width.
    height: 740,
    minWidth: 880,
    minHeight: 600,
    show: false,
    backgroundColor: '#141414', // Pre-theme first-paint color = dark palette --background (#141414).
    title: 'Meetvox',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // On macOS the app keeps running in the tray after the window closes. Drop the
  // dangling (destroyed) window reference and stop the pre-record monitor: its
  // levels interval would otherwise keep firing webContents.send into the dead
  // window ("Object has been destroyed"), and its open mic would block the device
  // when the window is reopened from the tray.
  mainWindow.on('closed', () => {
    mainWindow = null
    void ctx?.monitor.stop()
  })

  // External links open in the system browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** Show-or-create: focus the existing window, or create one if it was closed. */
function showWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  } else {
    createWindow()
  }
}

app.whenReady().then(() => {
  ctx = createContext()
  // A nicer About panel (mac ⌘-menu → About Meetvox, and the Win/Help about box).
  app.setAboutPanelOptions({ applicationName: 'Meetvox', applicationVersion: app.getVersion() })

  // Dev Dock icon: a dev run is the plain Electron bundle, so the Dock shows
  // Electron's icon. Packaged builds already get the Dock icon from build/icon.icns
  // via electron-builder, so only override in dev.
  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    const devIcon = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'icon.png'))
    if (!devIcon.isEmpty()) app.dock.setIcon(devIcon)
  }
  registerAudioProtocol(() => ctx.recordingsRoot)
  registerIpc(ctx, () => mainWindow)

  // Replace Electron's default menu (bold "Electron" + near-empty File) with the
  // real Meetvox menu. Uses showWindow so a menu click re-creates the window if it
  // was closed to the tray.
  installAppMenu(ctx, () => mainWindow, showWindow)

  createWindow()
  // The assignment to the module-level `tray` keeps the Tray alive (a local would
  // be GC'd and the icon would vanish). The `void` only suppresses the
  // "assigned but never read" lint warning.
  tray = createTray(ctx, () => mainWindow, showWindow)
  void tray

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
