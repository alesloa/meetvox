import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  settingsPath,
  setSecret,
  getSecret,
  hasSecret,
  clearSecret,
  secretIds,
  type SecretStorage
} from './settings'
import { DEFAULT_INTERVAL_SEC, GAIN_DEFAULT } from '@shared/constants'
import {
  DEFAULT_LOCAL_MODEL,
  DEFAULT_SERVER_URL,
  GROQ,
  OPENAI
} from '@shared/transcription'
import type { Settings } from '@shared/types'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'meetvox-settings-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

// A fake crypto backend — Electron safeStorage isn't available under vitest.
const fakeStorage: SecretStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('enc:' + s),
  decryptString: (b) => b.toString().replace('enc:', '')
}

describe('DEFAULT_SETTINGS', () => {
  test('is built from @shared/constants — no hardcoded numbers', () => {
    expect(DEFAULT_SETTINGS.intervalSec).toBe(DEFAULT_INTERVAL_SEC)
    expect(DEFAULT_SETTINGS.gains).toEqual({ mic: GAIN_DEFAULT, system: GAIN_DEFAULT })
    expect(DEFAULT_SETTINGS.transcription).toEqual({
      engine: 'local',
      localModel: DEFAULT_LOCAL_MODEL,
      serverUrl: DEFAULT_SERVER_URL,
      openaiModel: OPENAI.defaultModel,
      groqModel: GROQ.defaultModel
    })
    expect(DEFAULT_SETTINGS.theme).toBe('system')
    expect(DEFAULT_SETTINGS.sidebarCollapsed).toBe(false)
    expect(DEFAULT_SETTINGS.defaultMicId).toBeNull()
    expect(DEFAULT_SETTINGS.defaultSystemId).toBeNull()
    expect(DEFAULT_SETTINGS.preMonitorSystem).toBe(false)
    // null = use the built-in default recordings root (userData/recordings).
    expect(DEFAULT_SETTINGS.recordingsDir).toBeNull()
    // Empty is the honest default — Phase 8 seeds presets, NOT a stopgap.
    expect(DEFAULT_SETTINGS.summary).toEqual({ providers: [], defaultProviderId: null })
  })
})

describe('recordingsDir persistence', () => {
  test('round-trips a custom path and can be reset to null', () => {
    const custom = join(dir, 'My Recordings')
    expect(saveSettings(dir, { recordingsDir: custom }).recordingsDir).toBe(custom)
    expect(loadSettings(dir).recordingsDir).toBe(custom)
    // Reset: null must win over the stored path (not get `??`-coalesced back).
    expect(saveSettings(dir, { recordingsDir: null }).recordingsDir).toBeNull()
    expect(loadSettings(dir).recordingsDir).toBeNull()
  })
})

describe('transcription settings', () => {
  test('a pre-engines settings.json keeps its on-device model choice', () => {
    writeFileSync(
      settingsPath(dir),
      JSON.stringify({ modelFilename: 'ggml-large-v3-turbo-q5_0.bin' })
    )
    expect(loadSettings(dir).transcription.localModel).toBe('ggml-large-v3-turbo-q5_0.bin')
  })

  test('a legacy modelFilename is not written back after a save', () => {
    writeFileSync(settingsPath(dir), JSON.stringify({ modelFilename: DEFAULT_LOCAL_MODEL }))
    saveSettings(dir, { theme: 'dark' })
    const raw = JSON.parse(readFileSync(settingsPath(dir), 'utf8'))
    expect('modelFilename' in raw).toBe(false)
  })

  test('unknown engine or model in the file falls back to the defaults', () => {
    writeFileSync(
      settingsPath(dir),
      JSON.stringify({ transcription: { engine: 'banana', localModel: 'ggml-nope.bin' } })
    )
    const t = loadSettings(dir).transcription
    expect(t.engine).toBe('local')
    expect(t.localModel).toBe(DEFAULT_LOCAL_MODEL)
  })

  test('a partial transcription save keeps the other engines config', () => {
    saveSettings(dir, {
      transcription: { ...DEFAULT_SETTINGS.transcription, serverUrl: 'http://10.0.0.5:8080' }
    })
    saveSettings(dir, {
      transcription: { ...loadSettings(dir).transcription, engine: 'groq' }
    })
    const t = loadSettings(dir).transcription
    expect(t.engine).toBe('groq')
    expect(t.serverUrl).toBe('http://10.0.0.5:8080')
  })
})

describe('loadSettings', () => {
  test('empty dir returns DEFAULT_SETTINGS', () => {
    expect(loadSettings(dir)).toEqual(DEFAULT_SETTINGS)
  })

  test('partial settings.json merges over defaults', () => {
    writeFileSync(settingsPath(dir), JSON.stringify({ intervalSec: 60 }))
    const s = loadSettings(dir)
    expect(s.intervalSec).toBe(60)
    // Untouched fields keep defaults.
    expect(s.gains).toEqual({ mic: GAIN_DEFAULT, system: GAIN_DEFAULT })
    expect(s.transcription).toEqual(DEFAULT_SETTINGS.transcription)
  })

  test('malformed JSON returns defaults without throwing', () => {
    writeFileSync(settingsPath(dir), '{ this is : not valid json ')
    expect(() => loadSettings(dir)).not.toThrow()
    expect(loadSettings(dir)).toEqual(DEFAULT_SETTINGS)
  })

  test('ignores a secrets key in the file (not part of Settings)', () => {
    writeFileSync(
      settingsPath(dir),
      JSON.stringify({ theme: 'dark', secrets: { anthropic: 'whatever' } })
    )
    const s = loadSettings(dir)
    expect(s.theme).toBe('dark')
    expect('secrets' in (s as object)).toBe(false)
  })
})

describe('saveSettings', () => {
  test('round-trips a saved field', () => {
    saveSettings(dir, { theme: 'dark' })
    expect(loadSettings(dir).theme).toBe('dark')
  })

  test('returns the merged settings', () => {
    const merged = saveSettings(dir, { intervalSec: 45 })
    expect(merged.intervalSec).toBe(45)
    expect(merged.theme).toBe(DEFAULT_SETTINGS.theme)
  })

  test('does not wipe existing secrets', () => {
    setSecret(dir, 'anthropic', 'sk-real-key', fakeStorage)
    saveSettings(dir, { theme: 'dark' })
    expect(hasSecret(dir, 'anthropic')).toBe(true)
    expect(getSecret(dir, 'anthropic', fakeStorage)).toBe('sk-real-key')
  })

  test('keeps existing providers when a summary update omits them', () => {
    const provider = {
      id: 'claude-cli',
      label: 'Claude CLI',
      kind: 'cli' as const,
      enabled: true
    }
    saveSettings(dir, { summary: { providers: [provider], defaultProviderId: 'claude-cli' } })
    // A later partial update that only sets the default (no providers key, as a
    // future caller might construct) must not drop the stored providers.
    const merged = saveSettings(dir, {
      summary: { defaultProviderId: 'claude-cli' }
    } as unknown as Partial<Settings>)
    expect(merged.summary.providers).toHaveLength(1)
    expect(merged.summary.providers[0].id).toBe('claude-cli')
  })

  test('allows clearing the default provider to null', () => {
    saveSettings(dir, { summary: { providers: [], defaultProviderId: 'x' } })
    const merged = saveSettings(dir, { summary: { providers: [], defaultProviderId: null } })
    expect(merged.summary.defaultProviderId).toBeNull()
  })
})

describe('secret vault', () => {
  test('setSecret + getSecret round-trips', () => {
    setSecret(dir, 'anthropic', 'sk-ant-123', fakeStorage)
    expect(getSecret(dir, 'anthropic', fakeStorage)).toBe('sk-ant-123')
  })

  test('on-disk value is base64 and never the plaintext', () => {
    setSecret(dir, 'anthropic', 'sk-PLAINTEXT-SECRET', fakeStorage)
    const raw = readFileSync(settingsPath(dir), 'utf8')
    expect(raw).not.toContain('sk-PLAINTEXT-SECRET')
    const parsed = JSON.parse(raw)
    const stored = parsed.secrets.anthropic
    // base64 of the encrypted buffer
    expect(stored).toBe(Buffer.from('enc:sk-PLAINTEXT-SECRET').toString('base64'))
    // Re-encode round-trips as valid base64.
    expect(Buffer.from(stored, 'base64').toString('base64')).toBe(stored)
  })

  test('throws and writes nothing when encryption is unavailable', () => {
    const noEnc: SecretStorage = { ...fakeStorage, isEncryptionAvailable: () => false }
    expect(() => setSecret(dir, 'anthropic', 'sk-secret', noEnc)).toThrow(
      /OS encryption unavailable/
    )
    expect(hasSecret(dir, 'anthropic')).toBe(false)
    expect(secretIds(dir)).toEqual([])
  })

  test('getSecret returns null for a missing id', () => {
    expect(getSecret(dir, 'nope', fakeStorage)).toBeNull()
  })

  test('hasSecret / secretIds / clearSecret behave', () => {
    expect(hasSecret(dir, 'anthropic')).toBe(false)
    setSecret(dir, 'anthropic', 'k1', fakeStorage)
    setSecret(dir, 'openai', 'k2', fakeStorage)
    expect(hasSecret(dir, 'anthropic')).toBe(true)
    expect(secretIds(dir).sort()).toEqual(['anthropic', 'openai'])
    clearSecret(dir, 'anthropic')
    expect(hasSecret(dir, 'anthropic')).toBe(false)
    expect(secretIds(dir)).toEqual(['openai'])
  })

  test('setting a secret does not wipe existing settings fields', () => {
    saveSettings(dir, { theme: 'dark', intervalSec: 90 })
    setSecret(dir, 'anthropic', 'k1', fakeStorage)
    const s = loadSettings(dir)
    expect(s.theme).toBe('dark')
    expect(s.intervalSec).toBe(90)
  })
})
