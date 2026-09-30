// Opt-in integration test: sends a real speech wav to REAL engines. Skipped unless
// its env vars are set, so the normal unit suite never touches the network.
//
//   MEETVOX_INT_SPEECH_WAV  16 kHz mono wav of someone saying MEETVOX_INT_SPEECH_WORD
//   MEETVOX_INT_SPEECH_WORD a word the transcript must contain (case-insensitive)
//   MEETVOX_INT_SERVER      whisper-server address, e.g. http://127.0.0.1:8080
//   MEETVOX_INT_GROQ_KEY / MEETVOX_INT_OPENAI_KEY   run the cloud engines too

import { describe, it, expect } from 'vitest'
import { resolveEngine } from './engine'
import { DEFAULT_SETTINGS } from '../settings'
import type { TranscriptionSettings } from '@shared/types'

const WAV = process.env.MEETVOX_INT_SPEECH_WAV
const WORD = process.env.MEETVOX_INT_SPEECH_WORD?.toLowerCase()
const SERVER = process.env.MEETVOX_INT_SERVER
const KEYS: Record<string, string | undefined> = {
  groq: process.env.MEETVOX_INT_GROQ_KEY,
  openai: process.env.MEETVOX_INT_OPENAI_KEY
}

async function transcribeWith(t: Partial<TranscriptionSettings>): Promise<string> {
  const engine = await resolveEngine({
    settings: { ...DEFAULT_SETTINGS.transcription, ...t },
    getSecret: (id) => KEYS[id] ?? null,
    ensureLocalModel: async () => {
      throw new Error('not used')
    },
    whisperPath: ''
  })
  return engine.transcribe(WAV!)
}

describe.skipIf(!WAV || !WORD || !SERVER)('whisper-server — real', () => {
  it('transcribes real speech', async () => {
    expect((await transcribeWith({ engine: 'server', serverUrl: SERVER! })).toLowerCase()).toContain(WORD)
  }, 120_000)
})

describe.skipIf(!WAV || !WORD || !KEYS.groq)('Groq — real', () => {
  it('transcribes real speech', async () => {
    expect((await transcribeWith({ engine: 'groq' })).toLowerCase()).toContain(WORD)
  }, 120_000)
})

describe.skipIf(!WAV || !WORD || !KEYS.openai)('OpenAI — real', () => {
  it('transcribes real speech', async () => {
    expect((await transcribeWith({ engine: 'openai' })).toLowerCase()).toContain(WORD)
  }, 120_000)
})
