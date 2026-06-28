import { describe, it, expect } from 'vitest'
import { parseMaxVolume, isSilent } from './silence'
import { SILENCE_DEFAULT_DB, SILENCE_THRESHOLD_DB } from '@shared/constants'

const stderr = (max: string) =>
  [
    '[Parsed_volumedetect_0 @ 0x600000] n_samples: 320000',
    '[Parsed_volumedetect_0 @ 0x600000] mean_volume: -27.4 dB',
    `[Parsed_volumedetect_0 @ 0x600000] max_volume: ${max} dB`,
    '[Parsed_volumedetect_0 @ 0x600000] histogram_0db: 1'
  ].join('\n')

describe('parseMaxVolume — mirrors get_audio_level', () => {
  it('extracts the max_volume float in dB', () => {
    expect(parseMaxVolume(stderr('-3.4'))).toBeCloseTo(-3.4, 5)
  })

  it('does not mistake mean_volume for max_volume', () => {
    expect(parseMaxVolume(stderr('-50.1'))).toBeCloseTo(-50.1, 5)
  })

  it('handles -inf (digital silence) as -Infinity', () => {
    expect(parseMaxVolume(stderr('-inf'))).toBe(-Infinity)
  })

  it('returns the -100 default when max_volume is absent', () => {
    expect(parseMaxVolume('no volume line here')).toBe(SILENCE_DEFAULT_DB)
  })
})

describe('isSilent — threshold matches transcribe_meeting.py (-50 dB)', () => {
  it('treats levels at or below -50 dB as silent (Python: skip when NOT > threshold)', () => {
    expect(isSilent(-50)).toBe(true) // not > -50 -> silent
    expect(isSilent(-50.0001)).toBe(true)
    expect(isSilent(-Infinity)).toBe(true)
  })

  it('treats levels above -50 dB as speech', () => {
    expect(isSilent(-49.9)).toBe(false)
    expect(isSilent(-3)).toBe(false)
  })

  it('threshold constant is -50', () => {
    expect(SILENCE_THRESHOLD_DB).toBe(-50)
  })
})
