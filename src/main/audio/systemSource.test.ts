import { describe, it, expect } from 'vitest'
import { createSystemSource } from './systemSource'
import { MAC_SYSTEM_AUDIO_ID } from '@shared/constants'

// createSystemSource only constructs the source (no naudiodon import / no spawn until
// start()), so these assertions are side-effect-free. `kind` is the load-bearing seam:
// 'device' = capture a real PortAudio input (BlackHole loopback / WASAPI endpoint),
// 'screencapture' = the macOS ScreenCaptureKit helper (whole-mix fallback).
describe('createSystemSource — Mac picks loopback-input vs ScreenCaptureKit', () => {
  it('Mac + a real loopback device id → PortAudio input capture (like the Python BlackHole path)', () => {
    const src = createSystemSource('mac', { deviceId: 5, syscapPath: '/x/meetvox-syscap' })
    expect(src.kind).toBe('device')
    expect(src.channels).toBe(2)
  })

  it('Mac + the synthetic SCK id → ScreenCaptureKit helper', () => {
    const src = createSystemSource('mac', {
      deviceId: MAC_SYSTEM_AUDIO_ID,
      syscapPath: '/x/meetvox-syscap'
    })
    expect(src.kind).toBe('screencapture')
  })

  it('Mac + no device id (legacy callers) → ScreenCaptureKit helper', () => {
    const src = createSystemSource('mac', { syscapPath: '/x/meetvox-syscap' })
    expect(src.kind).toBe('screencapture')
  })

  it('Mac + ScreenCaptureKit but no syscap path → throws', () => {
    expect(() => createSystemSource('mac', { deviceId: MAC_SYSTEM_AUDIO_ID })).toThrow(/syscap/i)
  })

  it('Windows → PortAudio input capture of the chosen render endpoint', () => {
    const src = createSystemSource('win', { deviceId: 3 })
    expect(src.kind).toBe('device')
    expect(src.channels).toBe(2)
  })
})
