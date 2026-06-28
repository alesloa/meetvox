// Guarded renderer send. A BrowserWindow that has been closed is still a truthy
// JS object, so `getWindow()?.webContents.send(...)` does NOT protect against it —
// optional chaining only catches null/undefined, and calling `.send` on a
// destroyed window throws `TypeError: Object has been destroyed` (which, in the
// main process, is an uncaught exception → crash dialog). This happens when a
// timer/event (e.g. the Monitor's levels interval) fires after the window is gone.

import type { BrowserWindow } from 'electron'

/** True only when `win` exists and both its native window and webContents are
 *  still alive. `isDestroyed()` is checked first so we never read `webContents`
 *  on an already-destroyed window. */
export function canSend(win: BrowserWindow | null): boolean {
  return !!win && !win.isDestroyed() && !win.webContents.isDestroyed()
}

/** Send to the renderer only if the window can still receive it; otherwise no-op. */
export function safeSend(win: BrowserWindow | null, channel: string, payload: unknown): void {
  if (canSend(win)) win!.webContents.send(channel, payload)
}
