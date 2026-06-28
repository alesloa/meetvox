import { describe, it, expect } from 'vitest'
import { modelDir, modelFilePath, computeFraction, sizeLooksComplete } from './download'
import { MODEL_FILENAME } from '@shared/constants'

describe('model paths — ~/.meetvox/models', () => {
  it('builds the model dir and file path under the home dir', () => {
    expect(modelDir('/home/user')).toBe('/home/user/.meetvox/models')
    expect(modelFilePath('/home/user')).toBe(`/home/user/.meetvox/models/${MODEL_FILENAME}`)
  })
})

describe('computeFraction — progress bar value', () => {
  it('is received/total when total is known', () => {
    expect(computeFraction(50, 100)).toBeCloseTo(0.5, 6)
    expect(computeFraction(0, 100)).toBe(0)
    expect(computeFraction(100, 100)).toBe(1)
  })
  it('is -1 when total is unknown', () => {
    expect(computeFraction(50, 0)).toBe(-1)
    expect(computeFraction(50, -1)).toBe(-1)
  })
})

describe('sizeLooksComplete — guards against truncated downloads', () => {
  it('requires the written size to equal the advertised content length', () => {
    expect(sizeLooksComplete(1000, 1000)).toBe(true)
    expect(sizeLooksComplete(999, 1000)).toBe(false)
    expect(sizeLooksComplete(0, 0)).toBe(false)
  })
  it('when content length is unknown, requires a non-trivial size', () => {
    expect(sizeLooksComplete(600_000_000, -1)).toBe(true) // above the half-expected floor
    expect(sizeLooksComplete(1234, -1)).toBe(false)
  })
})
