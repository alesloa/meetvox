import { describe, it, expect } from 'vitest'
import { ipcErrorText } from './ipcError'

describe('ipcErrorText — show the real reason, not the IPC plumbing', () => {
  it("strips Electron's invoke prefix", () => {
    const e = new Error(
      "Error invoking remote method 'cmd:transcribe': Error: No Groq API key yet. Add it in Settings → Transcription."
    )
    expect(ipcErrorText(e)).toBe('No Groq API key yet. Add it in Settings → Transcription.')
  })

  it('leaves other errors alone', () => {
    expect(ipcErrorText(new Error('Disk full'))).toBe('Disk full')
    expect(ipcErrorText('plain string')).toBe('plain string')
  })
})
