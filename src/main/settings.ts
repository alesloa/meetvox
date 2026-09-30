// Settings persistence + an encrypted API-key vault, both backed by a single
// settings.json under userData. Defaults come from @shared/constants — never
// hardcoded. Secrets live under a `secrets` map, encrypted via an injected
// SecretStorage (Electron safeStorage in production), and are NEVER stored in
// plaintext and NEVER returned to the renderer.

import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { join } from 'path'
import { DEFAULT_INTERVAL_SEC, GAIN_DEFAULT } from '@shared/constants'
import {
  DEFAULT_LOCAL_MODEL,
  DEFAULT_SERVER_URL,
  ENGINE_LABELS,
  GROQ,
  OPENAI,
  findLocalModel,
  type TranscriptionEngine
} from '@shared/transcription'
import type { Settings, TranscriptionSettings } from '@shared/types'

/** Built entirely from constants. summary is empty here; Phase 8 seeds presets. */
export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  sidebarCollapsed: false,
  defaultMicId: null,
  defaultSystemId: null,
  gains: { mic: GAIN_DEFAULT, system: GAIN_DEFAULT },
  intervalSec: DEFAULT_INTERVAL_SEC,
  preMonitorSystem: false,
  recordingsDir: null,
  transcription: {
    engine: 'local',
    localModel: DEFAULT_LOCAL_MODEL,
    serverUrl: DEFAULT_SERVER_URL,
    openaiModel: OPENAI.defaultModel,
    groqModel: GROQ.defaultModel
  },
  summary: { providers: [], defaultProviderId: null }
}

export function settingsPath(userDataDir: string): string {
  return join(userDataDir, 'settings.json')
}

/** On-disk shape: the Settings fields plus an optional encrypted-secrets map. */
interface SettingsFile extends Omit<Partial<Settings>, 'transcription'> {
  secrets?: Record<string, string>
  transcription?: Partial<TranscriptionSettings>
  /** Pre-engines builds stored the on-device model here. Read once, never written. */
  modelFilename?: string
}

function isEngine(v: unknown): v is TranscriptionEngine {
  return typeof v === 'string' && Object.hasOwn(ENGINE_LABELS, v)
}

/** Validate the stored transcription block field by field; bad values fall back to defaults. */
function mergeTranscription(file: SettingsFile): TranscriptionSettings {
  const d = DEFAULT_SETTINGS.transcription
  const t = file.transcription ?? {}
  const localModel = t.localModel ?? file.modelFilename
  return {
    engine: isEngine(t.engine) ? t.engine : d.engine,
    localModel: localModel && findLocalModel(localModel) ? localModel : d.localModel,
    serverUrl: typeof t.serverUrl === 'string' ? t.serverUrl : d.serverUrl,
    openaiModel: t.openaiModel || d.openaiModel,
    groqModel: t.groqModel || d.groqModel
  }
}

/** Read + parse the raw file. Never throws — a missing/malformed file yields {}. */
function readFile(userDataDir: string): SettingsFile {
  const path = settingsPath(userDataDir)
  if (!existsSync(path)) return {}
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' ? (parsed as SettingsFile) : {}
  } catch {
    return {}
  }
}

/** Write atomically (tmp + rename) so a crash mid-write can't truncate
 *  settings.json and lose the encrypted secrets — matches models/download.ts. */
function writeFile(userDataDir: string, file: SettingsFile): void {
  const target = settingsPath(userDataDir)
  const tmp = target + '.tmp'
  writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf8')
  renameSync(tmp, target)
}

/** Deep-merge only the known Settings fields over DEFAULT_SETTINGS. */
function mergeSettings(file: SettingsFile): Settings {
  return {
    theme: file.theme ?? DEFAULT_SETTINGS.theme,
    sidebarCollapsed: file.sidebarCollapsed ?? DEFAULT_SETTINGS.sidebarCollapsed,
    defaultMicId: file.defaultMicId ?? DEFAULT_SETTINGS.defaultMicId,
    defaultSystemId: file.defaultSystemId ?? DEFAULT_SETTINGS.defaultSystemId,
    gains: { ...DEFAULT_SETTINGS.gains, ...(file.gains ?? {}) },
    intervalSec: file.intervalSec ?? DEFAULT_SETTINGS.intervalSec,
    preMonitorSystem: file.preMonitorSystem ?? DEFAULT_SETTINGS.preMonitorSystem,
    recordingsDir: file.recordingsDir ?? DEFAULT_SETTINGS.recordingsDir,
    transcription: mergeTranscription(file),
    summary: {
      providers: file.summary?.providers ?? DEFAULT_SETTINGS.summary.providers,
      defaultProviderId: file.summary?.defaultProviderId ?? DEFAULT_SETTINGS.summary.defaultProviderId
    }
  }
}

/**
 * Load settings, merged over defaults. A missing or malformed file yields
 * DEFAULT_SETTINGS. Any `secrets` key in the file is ignored — it belongs to
 * the vault, not to Settings.
 */
export function loadSettings(userDataDir: string): Settings {
  return mergeSettings(readFile(userDataDir))
}

/**
 * Merge `partial` over the current settings and write back, PRESERVING the
 * existing encrypted-secrets map. Returns the merged Settings.
 */
export function saveSettings(userDataDir: string, partial: Partial<Settings>): Settings {
  const file = readFile(userDataDir)
  const current = mergeSettings(file)
  const merged: Settings = {
    ...current,
    ...partial,
    gains: { ...current.gains, ...(partial.gains ?? {}) },
    transcription: { ...current.transcription, ...(partial.transcription ?? {}) },
    // Preserve providers if the caller omits them, but allow defaultProviderId to
    // be set to null (clear the default) — `??` would wrongly keep the old value.
    summary: partial.summary
      ? {
          providers: partial.summary.providers ?? current.summary.providers,
          defaultProviderId:
            partial.summary.defaultProviderId !== undefined
              ? partial.summary.defaultProviderId
              : current.summary.defaultProviderId
        }
      : current.summary
  }
  // Built from `merged`, so a legacy `modelFilename` in the file is dropped here.
  writeFile(userDataDir, { ...merged, secrets: file.secrets })
  return merged
}

// --- Encrypted key vault -------------------------------------------------

/** Crypto backend. In production this is Electron's `safeStorage`. */
export interface SecretStorage {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(enc: Buffer): string
}

function readSecrets(userDataDir: string): Record<string, string> {
  return readFile(userDataDir).secrets ?? {}
}

/**
 * Encrypt and persist a secret under `id`. THROWS if OS encryption is
 * unavailable — never falls back to plaintext, never writes anything.
 * Preserves the settings fields (read-modify-write).
 */
export function setSecret(
  userDataDir: string,
  id: string,
  plaintext: string,
  storage: SecretStorage
): void {
  if (!storage.isEncryptionAvailable()) {
    throw new Error('Cannot store key securely: OS encryption unavailable')
  }
  const encrypted = storage.encryptString(plaintext).toString('base64')
  const file = readFile(userDataDir)
  const secrets = { ...(file.secrets ?? {}), [id]: encrypted }
  writeFile(userDataDir, { ...file, secrets })
}

/**
 * Decrypt and return a secret, or null if none stored. Main-process only —
 * NEVER exposed via IPC.
 */
export function getSecret(
  userDataDir: string,
  id: string,
  storage: SecretStorage
): string | null {
  const b64 = readSecrets(userDataDir)[id]
  if (b64 === undefined) return null
  return storage.decryptString(Buffer.from(b64, 'base64'))
}

/** Whether a secret exists for `id`. No decryption. */
export function hasSecret(userDataDir: string, id: string): boolean {
  return readSecrets(userDataDir)[id] !== undefined
}

/** Delete the secret for `id` and write back. No-op if absent. */
export function clearSecret(userDataDir: string, id: string): void {
  const file = readFile(userDataDir)
  if (!file.secrets || !(id in file.secrets)) return
  const { [id]: _removed, ...rest } = file.secrets
  writeFile(userDataDir, { ...file, secrets: rest })
}

/** Ids of all stored secrets — used to build the renderer's {[id]: boolean} map. */
export function secretIds(userDataDir: string): string[] {
  return Object.keys(readSecrets(userDataDir))
}
