// Mic device classification + auto-selection. A faithful port of
// recorder_blackhole.py: get_input_devices / get_loopback_devices / auto_select_devices.
//
// System audio is platform-specific:
//   - Mac:  a loopback INPUT device (BlackHole 2ch) captured via PortAudio — exactly
//           how recorder_blackhole.py does it — listed ahead of a synthetic
//           "System Audio (built-in)" ScreenCaptureKit whole-mix fallback.
//   - Win:  WASAPI render endpoints, loopback-captured -> listed as provided.

import { LOOPBACK_NAME_FRAGMENTS, MAC_SYSTEM_AUDIO_ID } from '@shared/constants'
import type { AudioDevice, DeviceList, Platform } from '@shared/types'

export interface RawInputDevice {
  id: number
  name: string
  maxInputChannels: number
}

// Re-exported for existing main-process importers (the sentinel itself lives in
// @shared/constants so the renderer can reference it too).
export { MAC_SYSTEM_AUDIO_ID }
export const MAC_SYSTEM_AUDIO_NAME = 'System Audio (built-in)'

const isLoopbackName = (name: string): boolean => {
  const lower = name.toLowerCase()
  return LOOPBACK_NAME_FRAGMENTS.some((frag) => lower.includes(frag))
}

/** Input devices that are real microphones (excludes virtual/loopback devices). */
export function classifyMics(raw: RawInputDevice[]): AudioDevice[] {
  return raw
    .filter((d) => d.maxInputChannels > 0 && !isLoopbackName(d.name))
    .map((d) => ({ id: d.id, name: d.name, channels: d.maxInputChannels }))
}

/**
 * Virtual/loopback INPUT devices (BlackHole / Soundflower / Loopback) — the macOS
 * mirror of recorder_blackhole.py's get_loopback_devices. These ARE real PortAudio
 * input devices (their actual id/channels are preserved) and become selectable
 * system-audio capture sources.
 */
export function classifyLoopbacks(raw: RawInputDevice[]): AudioDevice[] {
  return raw
    .filter((d) => d.maxInputChannels > 0 && isLoopbackName(d.name))
    .map((d) => ({ id: d.id, name: d.name, channels: d.maxInputChannels }))
}

/** Auto-select: DJI mic -> macbook/built-in/microphone -> first device -> null. */
export function autoSelectMicId(mics: AudioDevice[]): number | null {
  const dji = mics.find((m) => {
    const n = m.name.toLowerCase()
    return n.includes('dji') && n.includes('mic')
  })
  if (dji) return dji.id

  const common = mics.find((m) => {
    const n = m.name.toLowerCase()
    return n.includes('macbook') || n.includes('built-in') || n.includes('microphone')
  })
  if (common) return common.id

  return mics.length > 0 ? mics[0].id : null
}

/**
 * Build the full device list for the renderer.
 * @param systemEndpoints Windows WASAPI render endpoints (ignored on Mac).
 */
export function buildDeviceList(
  platform: Platform,
  rawMics: RawInputDevice[],
  systemEndpoints: RawInputDevice[]
): DeviceList {
  const mics = classifyMics(rawMics)
  const autoMicId = autoSelectMicId(mics)

  let systems: AudioDevice[]
  if (platform === 'mac') {
    // Loopback inputs (BlackHole) first so a present one auto-selects (autoSystemId =
    // systems[0]) — mirroring auto_select_devices' BlackHole preference — then the
    // ScreenCaptureKit whole-mix fallback for machines without a loopback device.
    systems = [
      ...classifyLoopbacks(rawMics),
      { id: MAC_SYSTEM_AUDIO_ID, name: MAC_SYSTEM_AUDIO_NAME, channels: 2 }
    ]
  } else {
    // Windows: a virtual-cable INPUT (VB-Cable / VoiceMeeter) is captured directly as a
    // PortAudio input — the reliable Windows analogue of BlackHole — so list those first
    // (auto-selected when present). WASAPI render endpoints follow as the built-in
    // loopback option (works only where PortAudio's WASAPI loopback is available).
    systems = [
      ...classifyLoopbacks(rawMics),
      ...systemEndpoints.map((d) => ({
        id: d.id,
        name: d.name,
        channels: d.maxInputChannels || 2
      }))
    ]
  }
  const autoSystemId = systems.length > 0 ? systems[0].id : null

  return { mics, systems, autoMicId, autoSystemId }
}
