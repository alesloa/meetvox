// Live device enumeration via naudiodon (PortAudio), fed into the unit-tested
// buildDeviceList classifier. Mic list = real input devices; on Windows the
// system list is the WASAPI render endpoints to loopback-capture, on Mac it is the
// single synthetic "System Audio (built-in)" entry (handled by buildDeviceList).

import { buildDeviceList, type RawInputDevice } from './devices'
import type { DeviceList, Platform } from '@shared/types'

export async function enumerateDevices(platform: Platform): Promise<DeviceList> {
  const portAudio = await import('naudiodon2')
  const devices = portAudio.getDevices()

  const rawMics: RawInputDevice[] = devices
    .filter((d) => d.maxInputChannels > 0)
    .map((d) => ({ id: d.id, name: d.name, maxInputChannels: d.maxInputChannels }))

  let renderEndpoints: RawInputDevice[] = []
  if (platform === 'win') {
    // WASAPI render endpoints (outputs) are loopback-captured for system audio.
    renderEndpoints = devices
      .filter((d) => d.maxOutputChannels > 0 && /wasapi/i.test(d.hostAPIName))
      .map((d) => ({ id: d.id, name: d.name, maxInputChannels: 2 }))
    // Fallback: if host API name filtering yields nothing, use all output devices.
    if (renderEndpoints.length === 0) {
      renderEndpoints = devices
        .filter((d) => d.maxOutputChannels > 0)
        .map((d) => ({ id: d.id, name: d.name, maxInputChannels: 2 }))
    }
  }

  return buildDeviceList(platform, rawMics, renderEndpoints)
}
