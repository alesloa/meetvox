import { describe, it, expect, vi } from 'vitest'
import { createServer } from 'http'
import type { AddressInfo } from 'net'
import { resolveEngine, testEngine, type EngineDeps } from './engine'
import { DEFAULT_SETTINGS } from '../settings'
import { findLocalModel } from '@shared/transcription'
import type { TranscriptionSettings } from '@shared/types'

function deps(t: Partial<TranscriptionSettings>, secrets: Record<string, string> = {}): EngineDeps {
  return {
    settings: { ...DEFAULT_SETTINGS.transcription, ...t },
    getSecret: (id) => secrets[id] ?? null,
    ensureLocalModel: vi.fn(async (m) => `/models/${m.file}`),
    whisperPath: '/bin/whisper-cli'
  }
}

describe('resolveEngine', () => {
  it('This Mac: makes sure the chosen model is downloaded and names it', async () => {
    const d = deps({ engine: 'local', localModel: 'ggml-large-v3-turbo.bin' })
    const engine = await resolveEngine(d)
    expect(d.ensureLocalModel).toHaveBeenCalledWith(findLocalModel('ggml-large-v3-turbo.bin'))
    expect(engine.label).toBe('This Mac (Large v3 Turbo)')
  })

  it('Whisper server: names the host it will use', async () => {
    const engine = await resolveEngine(deps({ engine: 'server', serverUrl: '192.168.0.115:8080' }))
    expect(engine.label).toBe('Whisper server at 192.168.0.115:8080')
  })

  it('Whisper server: refuses a blank address', async () => {
    await expect(resolveEngine(deps({ engine: 'server', serverUrl: '  ' }))).rejects.toThrow(
      'No Whisper server address set. Add it in Settings → Transcription.'
    )
  })

  it('Groq: refuses to start without a key', async () => {
    await expect(resolveEngine(deps({ engine: 'groq' }))).rejects.toThrow(
      'No Groq API key yet. Add it in Settings → Transcription.'
    )
  })

  it('OpenAI: uses the shared "openai" key and names the model', async () => {
    const engine = await resolveEngine(
      deps({ engine: 'openai', openaiModel: 'gpt-4o-mini-transcribe' }, { openai: 'sk-x' })
    )
    expect(engine.label).toBe('OpenAI (gpt-4o-mini-transcribe)')
  })
})

describe('testEngine — sends one real second of silence', () => {
  it('reports ok with the time taken', async () => {
    const server = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ text: '' }))
      })
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const { port } = server.address() as AddressInfo
    try {
      const engine = await resolveEngine(deps({ engine: 'server', serverUrl: `127.0.0.1:${port}` }))
      const result = await testEngine(engine)
      expect(result.ok).toBe(true)
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
    }
  })

  it('reports the engine error instead of throwing', async () => {
    const engine = {
      label: 'x',
      transcribe: async (): Promise<string> => {
        throw new Error('Groq rejected the API key')
      }
    }
    expect(await testEngine(engine)).toEqual({ ok: false, error: 'Groq rejected the API key' })
  })
})
