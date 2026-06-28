// Per-meeting freeform notes, persisted as notes.md in the meeting directory.

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const NOTES_FILE = 'notes.md'

/** Read notes for a meeting directory. Returns '' if the file is absent or unreadable. */
export function getNotes(dir: string): string {
  try {
    const p = join(dir, NOTES_FILE)
    if (!existsSync(p)) return ''
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

/** Write notes for a meeting directory. Throws on a write error (disk full /
 *  permissions); the IPC handler lets it reject so the editor shows "Couldn't save". */
export function saveNotes(dir: string, text: string): void {
  writeFileSync(join(dir, NOTES_FILE), text, 'utf8')
}
