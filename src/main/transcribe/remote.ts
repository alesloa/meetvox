// Remote transcription — whisper.cpp's `whisper-server` (POST /inference) and the
// OpenAI-compatible POST /audio/transcriptions (OpenAI, Groq). Each builder returns
// the same (wavPath) => text function the pipeline already uses for whisper-cli, so
// the pipeline never knows where the words came from.
//
// Every failure becomes one plain sentence naming the engine, what went wrong, and
// where to fix it. Nothing falls back to another engine: a failed transcription
// fails loudly so the user can fix the setting.

import { readFileSync } from 'fs'
import { basename } from 'path'
import { parseWhisperOutput } from './whisper'
import { WHISPER_INPUT_RATE } from '@shared/constants'
import { normalizeServerUrl, type CloudProvider } from '@shared/transcription'

export type Transcribe = (wavPath: string) => Promise<string>

export const FIX_IT = 'Settings → Transcription'

// --- WAV helpers --------------------------------------------------------------

const PCM_HEADER_BYTES = 44

function wavHeader(f: { channels: number; sampleRate: number; bitsPerSample: number }, dataLen: number): Buffer {
  const blockAlign = (f.channels * f.bitsPerSample) / 8
  const h = Buffer.alloc(PCM_HEADER_BYTES)
  h.write('RIFF', 0, 'ascii')
  h.writeUInt32LE(36 + dataLen, 4)
  h.write('WAVE', 8, 'ascii')
  h.write('fmt ', 12, 'ascii')
  h.writeUInt32LE(16, 16) // fmt chunk size for PCM
  h.writeUInt16LE(1, 20) // PCM
  h.writeUInt16LE(f.channels, 22)
  h.writeUInt32LE(f.sampleRate, 24)
  h.writeUInt32LE(f.sampleRate * blockAlign, 28)
  h.writeUInt16LE(blockAlign, 32)
  h.writeUInt16LE(f.bitsPerSample, 34)
  h.write('data', 36, 'ascii')
  h.writeUInt32LE(dataLen, 40)
  return h
}

/** Silence in the exact format the pipeline sends (16 kHz mono 16-bit) — used by "Test". */
export function silentWav(seconds: number): Buffer {
  const dataLen = Math.round(seconds * WHISPER_INPUT_RATE) * 2
  const fmt = { channels: 1, sampleRate: WHISPER_INPUT_RATE, bitsPerSample: 16 }
  return Buffer.concat([wavHeader(fmt, dataLen), Buffer.alloc(dataLen)])
}

function findChunk(buf: Buffer, id: string): { start: number; size: number } | null {
  let offset = 12
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32LE(offset + 4)
    if (buf.toString('ascii', offset, offset + 4) === id) {
      return { start: offset + 8, size: Math.min(size, buf.length - offset - 8) }
    }
    offset += 8 + size + (size % 2) // chunks are word-aligned
  }
  return null
}

/**
 * Cut a PCM WAV into valid WAVs of at most `maxBytes` each, on frame boundaries.
 * A file that already fits comes back untouched.
 */
export function splitWav(buf: Buffer, maxBytes: number): Buffer[] {
  if (buf.length <= maxBytes) return [buf]
  const fmtChunk = findChunk(buf, 'fmt ')
  const dataChunk = findChunk(buf, 'data')
  if (!fmtChunk || !dataChunk) throw new Error('Not a PCM WAV file')
  const fmt = {
    channels: buf.readUInt16LE(fmtChunk.start + 2),
    sampleRate: buf.readUInt32LE(fmtChunk.start + 4),
    bitsPerSample: buf.readUInt16LE(fmtChunk.start + 14)
  }
  const frameBytes = (fmt.channels * fmt.bitsPerSample) / 8
  const perPiece = Math.floor((maxBytes - PCM_HEADER_BYTES) / frameBytes) * frameBytes
  if (perPiece <= 0) throw new Error(`Upload limit of ${maxBytes} bytes is too small for one audio frame`)

  const pcm = buf.subarray(dataChunk.start, dataChunk.start + dataChunk.size)
  const pieces: Buffer[] = []
  for (let off = 0; off < pcm.length; off += perPiece) {
    const slice = pcm.subarray(off, off + perPiece)
    pieces.push(Buffer.concat([wavHeader(fmt, slice.length), slice]))
  }
  return pieces
}

// --- HTTP helpers -------------------------------------------------------------

function get(obj: unknown, key: string): unknown {
  return typeof obj === 'object' && obj !== null && key in obj ? Reflect.get(obj, key) : undefined
}

/** The network-level reason fetch failed: ECONNREFUSED, ENOTFOUND, UND_ERR_HEADERS_TIMEOUT… */
function failureCode(e: unknown): string {
  const cause = get(e, 'cause')
  const code = get(cause, 'code')
  if (typeof code === 'string') return code
  const first = get(get(cause, 'errors'), '0') // AggregateError: one per address tried
  const firstCode = get(first, 'code')
  if (typeof firstCode === 'string') return firstCode
  return e instanceof Error ? e.message : String(e)
}

async function post(
  url: string,
  form: FormData,
  headers: Record<string, string>,
  unreachable: (code: string) => string
): Promise<{ status: number; ok: boolean; json: unknown; text: string }> {
  let res: Response
  try {
    res = await fetch(url, { method: 'POST', body: form, headers })
  } catch (e) {
    throw new Error(unreachable(failureCode(e)))
  }
  const text = await res.text()
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    json = undefined
  }
  return { status: res.status, ok: res.ok, json, text }
}

/** The error message an API put in its body, else the raw body (clipped). */
function apiMessage(json: unknown, text: string): string {
  const nested = get(get(json, 'error'), 'message')
  if (typeof nested === 'string') return nested
  const flat = get(json, 'error')
  if (typeof flat === 'string') return flat
  return text.trim().slice(0, 300)
}

function formWith(wav: Buffer, name: string, fields: Record<string, string>): FormData {
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), name)
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  return form
}

/** Read the wav, split it if it's over the limit, send each piece, join the text. */
async function transcribeInPieces(
  wavPath: string,
  maxBytes: number | undefined,
  send: (wav: Buffer, name: string) => Promise<string>
): Promise<string> {
  const name = basename(wavPath)
  const buf = readFileSync(wavPath)
  const pieces = maxBytes ? splitWav(buf, maxBytes) : [buf]
  const texts: string[] = []
  for (let i = 0; i < pieces.length; i++) {
    const pieceName = pieces.length > 1 ? name.replace(/\.wav$/i, `_part${i + 1}.wav`) : name
    texts.push(parseWhisperOutput(await send(pieces[i], pieceName)))
  }
  return texts.filter(Boolean).join(' ')
}

// --- Engines --------------------------------------------------------------------

/** whisper.cpp whisper-server. The model is whichever one the server loaded. */
export function serverTranscriber(opts: { baseUrl: string; maxUploadBytes?: number }): Transcribe {
  const base = normalizeServerUrl(opts.baseUrl)
  const where = `The Whisper server at ${base}`
  return (wavPath) =>
    transcribeInPieces(wavPath, opts.maxUploadBytes, async (wav, name) => {
      // language=auto matches the on-device engine; whisper-server otherwise defaults to English.
      const res = await post(
        `${base}/inference`,
        formWith(wav, name, { response_format: 'json', language: 'auto' }),
        {},
        (code) =>
          `Can't reach the Whisper server at ${base} (${code}). Make sure it's running, or change the address in ${FIX_IT}.`
      )
      if (!res.ok) {
        const detail = apiMessage(res.json, res.text)
        throw new Error(
          `${where} returned HTTP ${res.status}${detail ? `: ${detail}` : ''}. Check the address in ${FIX_IT}.`
        )
      }
      const error = get(res.json, 'error') // whisper-server reports failures inside a 200
      if (typeof error === 'string') throw new Error(`${where} failed: ${error}`)
      const text = get(res.json, 'text')
      if (typeof text !== 'string') {
        throw new Error(`${where} sent an answer Meetvox can't read. Is it a whisper.cpp server?`)
      }
      return text
    })
}

/** OpenAI or Groq. `language` is left out so the provider detects it. */
export function cloudTranscriber(opts: {
  provider: CloudProvider
  apiKey: string
  model: string
}): Transcribe {
  const { provider, apiKey, model } = opts
  return (wavPath) =>
    transcribeInPieces(wavPath, provider.maxUploadBytes, async (wav, name) => {
      const res = await post(
        `${provider.baseUrl}/audio/transcriptions`,
        formWith(wav, name, { model, response_format: 'json' }),
        { Authorization: `Bearer ${apiKey}` },
        (code) => `Can't reach ${provider.label} (${code}). Check your internet connection.`
      )
      if (res.status === 401) {
        throw new Error(
          `${provider.label} rejected the API key (HTTP 401: ${apiMessage(res.json, res.text)}). Update it in ${FIX_IT}.`
        )
      }
      if (!res.ok) {
        throw new Error(`${provider.label} returned HTTP ${res.status}: ${apiMessage(res.json, res.text)}`)
      }
      const text = get(res.json, 'text')
      if (typeof text !== 'string') {
        throw new Error(`${provider.label} sent an answer with no transcript text.`)
      }
      return text
    })
}
