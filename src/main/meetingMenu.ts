// Right-click menu for a meeting in the sidebar. A native menu, like the app menu in
// menu.ts. Main shows it and runs Show in Finder itself; every other item is handed
// back to the renderer, which owns the route, the rename field and the transcription.

import { Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { ExportFormat, MeetingMenuAction, MeetingMenuInput } from '@shared/types'

const EXPORTS: { format: ExportFormat; label: string }[] = [
  { format: 'md', label: 'Markdown' },
  { format: 'txt', label: 'Plain Text' },
  { format: 'srt', label: 'SRT' }
]

/** Pure template builder, so the menu can be unit-tested without Electron. */
export function buildMeetingMenuTemplate(
  input: MeetingMenuInput,
  isMac: boolean,
  handlers: { pick: (action: MeetingMenuAction) => void; reveal: () => void }
): MenuItemConstructorOptions[] {
  const pick = (action: MeetingMenuAction) => () => handlers.pick(action)
  const template: MenuItemConstructorOptions[] = [
    { label: 'Open', click: pick({ kind: 'open' }) },
    { label: 'Rename…', click: pick({ kind: 'rename' }) }
  ]

  // Matches the meeting page's controls. "Transcribe again" stays on that page.
  switch (input.transcription) {
    case 'running':
      template.push({ label: 'Stop Transcribing', click: pick({ kind: 'stop' }) })
      break
    case 'stopped':
      template.push({
        label: 'Continue Transcribing',
        click: pick({ kind: 'transcribe', mode: 'continue' })
      })
      break
    case 'busy':
    case 'idle':
      if (!input.hasTranscript) {
        template.push({
          label: 'Transcribe',
          enabled: input.transcription === 'idle',
          click: pick({ kind: 'transcribe', mode: 'fresh' })
        })
      }
      break
    default: {
      const _exhaustive: never = input.transcription
      throw new Error(`Unknown transcription state: ${String(_exhaustive)}`)
    }
  }

  template.push(
    { type: 'separator' },
    { label: isMac ? 'Show in Finder' : 'Show in File Explorer', click: handlers.reveal },
    {
      label: 'Export Transcript',
      enabled: input.hasTranscript,
      submenu: EXPORTS.map((e) => ({
        label: e.label,
        click: pick({ kind: 'export', format: e.format })
      }))
    },
    { type: 'separator' },
    // Deleting the meeting being transcribed would pull its audio out from under the run.
    { label: 'Delete…', enabled: input.transcription !== 'running', click: pick({ kind: 'delete' }) }
  )
  return template
}

/** Show the menu at the cursor. Resolves with the picked item, or null when it closes without one. */
export function popupMeetingMenu(
  win: BrowserWindow | null,
  input: MeetingMenuInput
): Promise<MeetingMenuAction | null> {
  return new Promise((resolve) => {
    const template = buildMeetingMenuTemplate(input, process.platform === 'darwin', {
      pick: resolve,
      reveal: () => shell.showItemInFolder(input.dir)
    })
    // Electron runs the clicked item before this close callback, so a pick wins.
    Menu.buildFromTemplate(template).popup({
      window: win ?? undefined,
      callback: () => resolve(null)
    })
  })
}
