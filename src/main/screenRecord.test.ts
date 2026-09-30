import { describe, it, expect, vi } from 'vitest'
import { openScreenRecorder } from './screenRecord'

describe('openScreenRecorder', () => {
  it('opens the macOS Screenshot toolbar (the Cmd+Shift+5 app)', async () => {
    const openPath = vi.fn().mockResolvedValue('')
    await openScreenRecorder({ platform: 'mac', openPath })
    expect(openPath).toHaveBeenCalledWith('/System/Applications/Utilities/Screenshot.app')
  })

  it('rejects with the OS error when the app fails to open', async () => {
    const openPath = vi.fn().mockResolvedValue('The application cannot be opened')
    await expect(openScreenRecorder({ platform: 'mac', openPath })).rejects.toThrow(
      'The application cannot be opened'
    )
  })

  it('rejects on Windows without trying to open anything', async () => {
    const openPath = vi.fn()
    await expect(openScreenRecorder({ platform: 'win', openPath })).rejects.toThrow(
      'Screen recording is only available on macOS'
    )
    expect(openPath).not.toHaveBeenCalled()
  })
})
