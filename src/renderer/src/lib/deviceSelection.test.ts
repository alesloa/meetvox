import { describe, it, expect } from 'vitest'
import { resolveDeviceSelection } from './deviceSelection'

describe('resolveDeviceSelection — initial mic/system precedence', () => {
  it('keeps an explicit in-session pick over everything else', () => {
    // User already changed the dropdown this session — never clobber it.
    expect(resolveDeviceSelection(7, -1, 5)).toBe(7)
  })

  it('prefers a saved default over auto-select', () => {
    // The reported bug: a saved "System Audio (built-in)" (-1) must beat auto (BlackHole id 5).
    expect(resolveDeviceSelection(null, -1, 5)).toBe(-1)
  })

  it('treats device id 0 as a real saved default, not "unset"', () => {
    // Guards against a `||` regression — id 0 is falsy but valid.
    expect(resolveDeviceSelection(null, 0, 5)).toBe(0)
    expect(resolveDeviceSelection(0, null, 5)).toBe(0)
  })

  it('falls back to auto-select when there is no saved default', () => {
    expect(resolveDeviceSelection(null, null, 5)).toBe(5)
  })

  it('treats undefined saved default (settings not loaded) as no default', () => {
    expect(resolveDeviceSelection(null, undefined, 5)).toBe(5)
  })

  it('returns null when nothing is available', () => {
    expect(resolveDeviceSelection(null, null, null)).toBeNull()
  })
})
