import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import type { AddressInfo } from 'net'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { readWavDuration } from '../audio/wav'
import { silentWav, splitWav, serverTranscriber, cloudTranscriber } from './remote'
import { GROQ, OPENAI, normalizeServerUrl } from '@shared/transcription'
import { WHISPER_INPUT_RATE } from '@shared/constants'

interface Seen {
  method: string
  url: string
  auth: string | undefined
  form: FormData
}

type Reply = (seen: Seen, res: ServerResponse) => void

/** A real HTTP server on an OS-assigned port. Parses each multipart request. */
async function startServer(reply: Reply): Promise<{ url: string; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = []
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', async () => {
      const form = await new Response(Buffer.concat(chunks), {
        headers: { 'content-type': req.headers['content-type'] ?? '' }
      }).formData()
      const s = { method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization, form }
      seen.push(s)
      reply(s, res)
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise((r) => server.close(() => r()))
  }
}

/** A port that was just bound and released — nothing listens there. */
async function closedPortUrl(): Promise<string> {
  const s = await startServer(() => {})
  await s.close()
  return s.url
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

let dir: string
let wavPath: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'meetvox-remote-'))
  wavPath = join(dir, 'left_1.wav')
  writeFileSync(wavPath, silentWav(1))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('normalizeServerUrl — accept what people paste', () => {
  it('adds http:// and drops trailing slashes', () => {
    expect(normalizeServerUrl(' 192.168.0.115:8080/ ')).toBe('http://192.168.0.115:8080')
  })
  it('drops a pasted /inference path', () => {
    expect(normalizeServerUrl('http://mac-studio:8080/inference')).toBe('http://mac-studio:8080')
  })
  it('keeps https and returns empty for blank input', () => {
    expect(normalizeServerUrl('https://whisper.example.com')).toBe('https://whisper.example.com')
    expect(normalizeServerUrl('   ')).toBe('')
  })
})

describe('silentWav + splitWav', () => {
  it('silentWav is 16 kHz mono 16-bit PCM of the asked length', () => {
    expect(readWavDuration(silentWav(1))).toEqual({
      channels: 1,
      sampleRate: WHISPER_INPUT_RATE,
      frames: WHISPER_INPUT_RATE,
      durationSec: 1
    })
  })

  it('returns the file untouched when it fits', () => {
    const wav = silentWav(1)
    expect(splitWav(wav, wav.length)).toEqual([wav])
  })

  it('cuts on frame boundaries into valid wavs that each fit and add up to the whole', () => {
    const pieces = splitWav(silentWav(1), 44 + 10_001)
    expect(pieces.map((p) => p.length)).toEqual([44 + 10_000, 44 + 10_000, 44 + 10_000, 44 + 2_000])
    const frames = pieces.map((p) => readWavDuration(p).frames)
    expect(frames.reduce((a, b) => a + b, 0)).toBe(WHISPER_INPUT_RATE)
  })
})

describe('serverTranscriber — whisper.cpp /inference', () => {
  it('posts the wav with json + auto language and returns trimmed text', async () => {
    const s = await startServer((_seen, res) => json(res, 200, { text: ' Hello there.\n' }))
    try {
      const text = await serverTranscriber({ baseUrl: s.url })(wavPath)
      expect(text).toBe('Hello there.')
      expect(s.seen[0].method).toBe('POST')
      expect(s.seen[0].url).toBe('/inference')
      expect(s.seen[0].form.get('response_format')).toBe('json')
      expect(s.seen[0].form.get('language')).toBe('auto')
      expect(s.seen[0].form.get('file')).toHaveProperty('name', 'left_1.wav')
    } finally {
      await s.close()
    }
  })

  it('treats a blank marker as no speech', async () => {
    const s = await startServer((_seen, res) => json(res, 200, { text: ' [BLANK_AUDIO]\n' }))
    try {
      expect(await serverTranscriber({ baseUrl: s.url })(wavPath)).toBe('')
    } finally {
      await s.close()
    }
  })

  it('sends a too-big file in pieces and joins the text', async () => {
    let n = 0
    const s = await startServer((_seen, res) => json(res, 200, { text: `part${++n}` }))
    try {
      const text = await serverTranscriber({ baseUrl: s.url, maxUploadBytes: 44 + 16_000 })(wavPath)
      expect(s.seen).toHaveLength(2)
      expect(text).toBe('part1 part2')
    } finally {
      await s.close()
    }
  })

  it('says the server is unreachable, with the address and where to fix it', async () => {
    const url = await closedPortUrl()
    await expect(serverTranscriber({ baseUrl: url })(wavPath)).rejects.toThrow(
      `Can't reach the Whisper server at ${url} (ECONNREFUSED). Make sure it's running, or change the address in Settings → Transcription.`
    )
  })

  it('passes on the error whisper-server reports inside a 200', async () => {
    const s = await startServer((_seen, res) => json(res, 200, { error: 'failed to process audio' }))
    try {
      await expect(serverTranscriber({ baseUrl: s.url })(wavPath)).rejects.toThrow(
        `The Whisper server at ${s.url} failed: failed to process audio`
      )
    } finally {
      await s.close()
    }
  })

  it('names the HTTP status when the address is not a whisper server', async () => {
    const s = await startServer((_seen, res) => {
      res.writeHead(404)
      res.end('Not Found')
    })
    try {
      await expect(serverTranscriber({ baseUrl: s.url })(wavPath)).rejects.toThrow(
        `The Whisper server at ${s.url} returned HTTP 404: Not Found. Check the address in Settings → Transcription.`
      )
    } finally {
      await s.close()
    }
  })
})

describe('cloudTranscriber — OpenAI-compatible /audio/transcriptions', () => {
  it('sends the key, model and json format, and no language (auto-detect)', async () => {
    const s = await startServer((_seen, res) => json(res, 200, { text: 'Hi from Groq.' }))
    try {
      const provider = { ...GROQ, baseUrl: `${s.url}/openai/v1` }
      const text = await cloudTranscriber({ provider, apiKey: 'gsk_test', model: 'whisper-large-v3-turbo' })(wavPath)
      expect(text).toBe('Hi from Groq.')
      expect(s.seen[0].url).toBe('/openai/v1/audio/transcriptions')
      expect(s.seen[0].auth).toBe('Bearer gsk_test')
      expect(s.seen[0].form.get('model')).toBe('whisper-large-v3-turbo')
      expect(s.seen[0].form.get('response_format')).toBe('json')
      expect(s.seen[0].form.has('language')).toBe(false)
    } finally {
      await s.close()
    }
  })

  it('says the key was rejected on 401', async () => {
    const s = await startServer((_seen, res) =>
      json(res, 401, { error: { message: 'Incorrect API key provided' } })
    )
    try {
      const provider = { ...OPENAI, baseUrl: s.url }
      await expect(
        cloudTranscriber({ provider, apiKey: 'sk-bad', model: 'gpt-transcribe' })(wavPath)
      ).rejects.toThrow(
        'OpenAI rejected the API key (HTTP 401: Incorrect API key provided). Update it in Settings → Transcription.'
      )
    } finally {
      await s.close()
    }
  })

  it('shows the API message for other errors', async () => {
    const s = await startServer((_seen, res) =>
      json(res, 429, { error: { message: 'Rate limit reached' } })
    )
    try {
      const provider = { ...OPENAI, baseUrl: s.url }
      await expect(
        cloudTranscriber({ provider, apiKey: 'sk-ok', model: 'gpt-transcribe' })(wavPath)
      ).rejects.toThrow('OpenAI returned HTTP 429: Rate limit reached')
    } finally {
      await s.close()
    }
  })

  it('says the provider is unreachable', async () => {
    const url = await closedPortUrl()
    const provider = { ...GROQ, baseUrl: url }
    await expect(
      cloudTranscriber({ provider, apiKey: 'gsk', model: 'whisper-large-v3' })(wavPath)
    ).rejects.toThrow("Can't reach Groq (ECONNREFUSED). Check your internet connection.")
  })
})
