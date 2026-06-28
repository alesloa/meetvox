import { describe, it, expect } from 'vitest'
import { pcmFloat32 } from './pcm'

describe('pcmFloat32 — decode interleaved 32-bit float LE PCM', () => {
  it('decodes float samples', () => {
    const buf = Buffer.alloc(12)
    buf.writeFloatLE(0.5, 0)
    buf.writeFloatLE(-0.25, 4)
    buf.writeFloatLE(1.0, 8)
    expect(Array.from(pcmFloat32(buf))).toEqual([0.5, -0.25, 1.0])
  })

  it('ignores a trailing partial sample (non-multiple of 4 bytes)', () => {
    const buf = Buffer.alloc(6)
    buf.writeFloatLE(0.5, 0)
    expect(pcmFloat32(buf).length).toBe(1)
  })

  it('empty buffer -> empty array', () => {
    expect(pcmFloat32(Buffer.alloc(0)).length).toBe(0)
  })
})
