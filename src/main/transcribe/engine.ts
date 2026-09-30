// Picks the transcription engine from settings and returns one (wavPath) => text
// function plus a human label for progress messages. Missing config (no server
// address, no API key) fails here, before any audio is touched.

import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { transcribe as whisperTranscribe } from './whisper'
import { cloudTranscriber, FIX_IT, serverTranscriber, silentWav, type Transcribe } from './remote'
import {
  CLOUD_PROVIDERS,
  findLocalModel,
  normalizeServerUrl,
  OPENAI,
  type LocalModel
} from '@shared/transcription'
import type { EngineTestResult, TranscriptionSettings } from '@shared/types'

// Long imports go to the server in pieces no bigger than the cloud upload limit, so
// no single request waits past Node fetch's 300 s header timeout (undici default).
const SERVER_PIECE_BYTES = OPENAI.maxUploadBytes

export interface EngineDeps {
  settings: TranscriptionSettings
  /** Decrypted API key from the vault, or null. */
  getSecret: (id: string) => string | null
  /** Path to the on-device model, downloading it first if it's missing. */
  ensureLocalModel: (model: LocalModel) => Promise<string>
  whisperPath: string
}

export interface Engine {
  label: string
  transcribe: Transcribe
}

export async function resolveEngine(deps: EngineDeps): Promise<Engine> {
  const t = deps.settings
  switch (t.engine) {
    case 'local': {
      const model = findLocalModel(t.localModel)
      if (!model) throw new Error(`Unknown on-device model "${t.localModel}". Pick one in ${FIX_IT}.`)
      const modelPath = await deps.ensureLocalModel(model)
      return {
        label: `This Mac (${model.label})`,
        transcribe: (wavPath) =>
          whisperTranscribe({ whisperPath: deps.whisperPath, modelPath, wavPath })
      }
    }
    case 'server': {
      const baseUrl = normalizeServerUrl(t.serverUrl)
      if (!baseUrl) throw new Error(`No Whisper server address set. Add it in ${FIX_IT}.`)
      return {
        label: `Whisper server at ${baseUrl.replace(/^https?:\/\//i, '')}`,
        transcribe: serverTranscriber({ baseUrl, maxUploadBytes: SERVER_PIECE_BYTES })
      }
    }
    case 'openai':
    case 'groq': {
      const provider = CLOUD_PROVIDERS[t.engine]
      const apiKey = deps.getSecret(provider.secretId)
      if (!apiKey) throw new Error(`No ${provider.label} API key yet. Add it in ${FIX_IT}.`)
      const model = t.engine === 'openai' ? t.openaiModel : t.groqModel
      return {
        label: `${provider.label} (${model})`,
        transcribe: cloudTranscriber({ provider, apiKey, model })
      }
    }
    default: {
      const _exhaustive: never = t.engine
      throw new Error(`Unknown transcription engine: ${String(_exhaustive)}`)
    }
  }
}

/** Send one second of silence through the engine — proves address, key and model work. */
export async function testEngine(engine: Engine): Promise<EngineTestResult> {
  const dir = mkdtempSync(join(tmpdir(), 'meetvox-test-'))
  const wav = join(dir, 'test.wav')
  try {
    writeFileSync(wav, silentWav(1))
    const started = Date.now()
    await engine.transcribe(wav)
    return { ok: true, ms: Date.now() - started }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
