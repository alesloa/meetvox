import { describe, it, expect } from 'vitest'
import {
  classifyMics,
  classifyLoopbacks,
  autoSelectMicId,
  buildDeviceList,
  type RawInputDevice
} from './devices'
import { SPEAKER_LEFT } from '@shared/constants'

const dev = (id: number, name: string, ch = 1): RawInputDevice => ({
  id,
  name,
  maxInputChannels: ch
})

describe('classifyMics — excludes virtual/loopback devices (get_input_devices)', () => {
  it('drops blackhole / soundflower / loopback by name (case-insensitive)', () => {
    const raw = [
      dev(0, 'MacBook Pro Microphone'),
      dev(1, 'BlackHole 2ch', 2),
      dev(2, 'Soundflower (2ch)', 2),
      dev(3, 'Loopback Audio', 2),
      dev(4, 'DJI MIC MINI'),
      dev(5, 'Speakers (output only)', 0)
    ]
    const mics = classifyMics(raw)
    expect(mics.map((m) => m.name)).toEqual(['MacBook Pro Microphone', 'DJI MIC MINI'])
  })

  it('drops devices with zero input channels', () => {
    expect(classifyMics([dev(0, 'Output Device', 0)])).toEqual([])
  })
})

describe('classifyLoopbacks — keeps ONLY virtual/loopback inputs (get_loopback_devices)', () => {
  it('keeps blackhole/soundflower/loopback, drops real mics, preserves id + channels', () => {
    const raw = [
      dev(0, 'MacBook Pro Microphone'),
      dev(1, 'BlackHole 2ch', 2),
      dev(2, 'Soundflower (2ch)', 2),
      dev(3, 'Loopback Audio', 2),
      dev(4, 'DJI MIC MINI')
    ]
    expect(classifyLoopbacks(raw)).toEqual([
      { id: 1, name: 'BlackHole 2ch', channels: 2 },
      { id: 2, name: 'Soundflower (2ch)', channels: 2 },
      { id: 3, name: 'Loopback Audio', channels: 2 }
    ])
  })

  it('returns [] when no loopback device is present', () => {
    expect(classifyLoopbacks([dev(0, 'Built-in Microphone')])).toEqual([])
  })
})

describe('autoSelectMicId — mirrors auto_select_devices priority', () => {
  it('prefers a DJI mic first', () => {
    const mics = classifyMics([dev(0, 'MacBook Pro Microphone'), dev(1, 'DJI Mic 2')])
    expect(autoSelectMicId(mics)).toBe(1)
  })

  it('falls back to macbook/built-in/microphone', () => {
    const mics = classifyMics([dev(0, 'USB Audio'), dev(1, 'Built-in Microphone')])
    expect(autoSelectMicId(mics)).toBe(1)
  })

  it('falls back to the first device when nothing matches', () => {
    const mics = classifyMics([dev(7, 'Scarlett Solo'), dev(8, 'Some Interface')])
    expect(autoSelectMicId(mics)).toBe(7)
  })

  it('returns null when there are no mics', () => {
    expect(autoSelectMicId([])).toBeNull()
  })
})

describe('buildDeviceList — platform system-audio handling', () => {
  it('Mac: with no loopback device, system list is the single synthetic SCK entry, auto-selected', () => {
    const list = buildDeviceList('mac', [dev(0, 'Built-in Microphone')], [])
    expect(list.mics.map((m) => m.name)).toEqual(['Built-in Microphone'])
    expect(list.systems).toHaveLength(1)
    expect(list.systems[0].name).toBe('System Audio (built-in)')
    expect(list.autoSystemId).toBe(list.systems[0].id)
    expect(list.autoMicId).toBe(0)
  })

  it('Mac: lists loopback inputs (BlackHole) BEFORE the synthetic SCK fallback, auto-selects BlackHole', () => {
    const list = buildDeviceList(
      'mac',
      [dev(0, 'Built-in Microphone'), dev(5, 'BlackHole 2ch', 2)],
      []
    )
    // BlackHole stays OUT of the mic list (it's a loopback, not a real mic)...
    expect(list.mics.map((m) => m.name)).toEqual(['Built-in Microphone'])
    // ...and becomes the first, auto-selected system option ahead of the fallback.
    expect(list.systems.map((s) => s.name)).toEqual(['BlackHole 2ch', 'System Audio (built-in)'])
    expect(list.systems[0]).toEqual({ id: 5, name: 'BlackHole 2ch', channels: 2 })
    expect(list.autoSystemId).toBe(5)
  })

  it('Windows: system dropdown lists provided WASAPI render endpoints; first auto-selected', () => {
    const list = buildDeviceList(
      'win',
      [dev(0, 'Microphone (Realtek)')],
      [
        { id: 10, name: 'Speakers (Realtek)', maxInputChannels: 2 },
        { id: 11, name: 'Headphones', maxInputChannels: 2 }
      ]
    )
    expect(list.systems.map((s) => s.name)).toEqual(['Speakers (Realtek)', 'Headphones'])
    expect(list.autoSystemId).toBe(10)
  })

  it('Windows: lists a VB-Cable / virtual-cable INPUT ahead of render endpoints, auto-selects it', () => {
    const list = buildDeviceList(
      'win',
      [dev(0, 'Microphone (Realtek)'), dev(7, 'CABLE Output (VB-Audio Virtual Cable)', 2)],
      [{ id: 10, name: 'Speakers (Realtek)', maxInputChannels: 2 }]
    )
    // The virtual cable is a real input, NOT a mic...
    expect(list.mics.map((m) => m.name)).toEqual(['Microphone (Realtek)'])
    // ...and becomes the first, auto-selected system option (a reliable PortAudio input,
    // the Windows analogue of BlackHole) ahead of the WASAPI render endpoint.
    expect(list.systems.map((s) => s.name)).toEqual([
      'CABLE Output (VB-Audio Virtual Cable)',
      'Speakers (Realtek)'
    ])
    expect(list.systems[0]).toEqual({
      id: 7,
      name: 'CABLE Output (VB-Audio Virtual Cable)',
      channels: 2
    })
    expect(list.autoSystemId).toBe(7)
  })

  it('left channel speaker constant is "You" (load-bearing mapping)', () => {
    expect(SPEAKER_LEFT).toBe('You')
  })
})
