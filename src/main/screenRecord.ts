// Opens the macOS screenshot / screen-recording toolbar — the same UI as Cmd+Shift+5.
// Launching Screenshot.app (not `screencapture`) keeps the capture under Apple's own
// app, so Meetvox never needs the Screen Recording permission for it.

import type { Platform } from '@shared/types'

const SCREENSHOT_APP = '/System/Applications/Utilities/Screenshot.app'

export async function openScreenRecorder(deps: {
  platform: Platform
  /** Electron's shell.openPath: resolves '' on success, an error message on failure. */
  openPath: (path: string) => Promise<string>
}): Promise<void> {
  if (deps.platform !== 'mac') throw new Error('Screen recording is only available on macOS')
  const err = await deps.openPath(SCREENSHOT_APP)
  if (err) throw new Error(err)
}
