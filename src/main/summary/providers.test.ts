import { describe, test, expect } from 'vitest'
import { pick, PRESETS } from './providers'
import type { SummaryConfig } from './types'

// ── pick() ──────────────────────────────────────────────────────────────────

describe('pick', () => {
  test('default wins when enabled', () => {
    const config: SummaryConfig = {
      providers: [
        { id: 'a', label: 'a', kind: 'cli', enabled: true },
        { id: 'b', label: 'b', kind: 'cli', enabled: true },
      ],
      defaultProviderId: 'b',
    }
    expect(pick(config)!.id).toBe('b')
  })

  test('falls back to first enabled when default is disabled', () => {
    const config: SummaryConfig = {
      providers: [
        { id: 'a', label: 'a', kind: 'cli', enabled: false },
        { id: 'b', label: 'b', kind: 'cli', enabled: true },
      ],
      defaultProviderId: 'a',
    }
    expect(pick(config)!.id).toBe('b')
  })

  test('null when none enabled', () => {
    const config: SummaryConfig = {
      providers: [{ id: 'a', label: 'a', kind: 'cli', enabled: false }],
      defaultProviderId: null,
    }
    expect(pick(config)).toBeNull()
  })

  test('null when defaultProviderId names unknown provider and none enabled', () => {
    const config: SummaryConfig = {
      providers: [{ id: 'a', label: 'a', kind: 'cli', enabled: false }],
      defaultProviderId: 'missing',
    }
    expect(pick(config)).toBeNull()
  })
})

// ── PRESETS ──────────────────────────────────────────────────────────────────

describe('PRESETS', () => {
  test('has exactly 4 presets with correct ids', () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      'claude-cli',
      'codex-cli',
      'anthropic',
      'openai',
    ])
  })

  test('all presets disabled by default', () => {
    expect(PRESETS.every((p) => p.enabled === false)).toBe(true)
  })

  test('CLI presets have correct command arrays', () => {
    const claudeCli = PRESETS.find((p) => p.id === 'claude-cli')!
    const codexCli = PRESETS.find((p) => p.id === 'codex-cli')!
    expect(claudeCli.command).toEqual(['claude', '-p'])
    expect(codexCli.command).toEqual(['codex', 'exec'])
  })

  test('CLI presets have null model', () => {
    const cliPresets = PRESETS.filter((p) => p.kind === 'cli')
    expect(cliPresets.every((p) => p.model === null)).toBe(true)
  })

  test('API presets have correct baseUrls', () => {
    const anthropic = PRESETS.find((p) => p.id === 'anthropic')!
    const openai = PRESETS.find((p) => p.id === 'openai')!
    expect(anthropic.baseUrl).toBe('https://api.anthropic.com')
    expect(openai.baseUrl).toBe('https://api.openai.com/v1')
  })

  test('API presets pin their default model strings', () => {
    expect(PRESETS.find((p) => p.id === 'anthropic')!.model).toBe('claude-sonnet-4-6')
    expect(PRESETS.find((p) => p.id === 'openai')!.model).toBe('gpt-4o')
  })
})
