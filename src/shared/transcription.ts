// Transcription engines and their model catalogs. Every id, size, hash, URL and
// limit here was checked on 2026-09-30 against the source named beside it. When a
// provider changes its lineup, update the list from that source — never guess.

/** Which engine turns audio into text. One is active at a time. */
export type TranscriptionEngine = 'local' | 'server' | 'openai' | 'groq'

export const ENGINE_LABELS: Record<TranscriptionEngine, string> = {
  local: 'This Mac',
  server: 'Whisper server',
  openai: 'OpenAI',
  groq: 'Groq'
}

// --- On-device (bundled whisper-cli) ---------------------------------------

export interface LocalModel {
  file: string
  label: string
  note: string
  /** Exact file size — the x-linked-size Hugging Face reports for the LFS object. */
  bytes: number
  /** SHA-256 of the file — the LFS oid on Hugging Face. */
  sha256: string
}

// Sizes + hashes: https://huggingface.co/api/models/ggerganov/whisper.cpp/tree/main
// Turbo note: openai/whisper README — "an optimized version of large-v3 that offers
// faster transcription speed with a minimal degradation in accuracy" (~8x vs 1x).
export const LOCAL_MODELS: readonly LocalModel[] = [
  {
    file: 'ggml-large-v3-turbo.bin',
    label: 'Large v3 Turbo',
    note: 'About 8x faster than Large v3, with a small accuracy drop.',
    bytes: 1_624_555_275,
    sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69'
  },
  {
    file: 'ggml-large-v3-turbo-q5_0.bin',
    label: 'Large v3 Turbo (compressed)',
    note: 'Same Turbo model, compressed to about a third of the download.',
    bytes: 574_041_195,
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2'
  },
  {
    file: 'ggml-large-v3-q5_0.bin',
    label: 'Large v3 (compressed)',
    note: 'Full Large v3, compressed. Slower than Turbo.',
    bytes: 1_081_140_203,
    sha256: 'd75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1'
  }
]

/** The model Meetvox shipped with — kept as the default so no one gets a surprise download. */
export const DEFAULT_LOCAL_MODEL = 'ggml-large-v3-q5_0.bin'

export function localModelUrl(file: string): string {
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`
}

export function findLocalModel(file: string): LocalModel | undefined {
  return LOCAL_MODELS.find((m) => m.file === file)
}

// --- Whisper server (whisper.cpp `whisper-server`) --------------------------

/** whisper-server's own defaults: hostname 127.0.0.1, port 8080 (examples/server/server.cpp). */
export const DEFAULT_SERVER_URL = 'http://127.0.0.1:8080'

/** Accept "192.168.0.115:8080", "http://host:8080/", or a pasted ".../inference". */
export function normalizeServerUrl(input: string): string {
  let url = input.trim()
  if (!url) return ''
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`
  return url.replace(/\/+$/, '').replace(/\/inference$/i, '').replace(/\/+$/, '')
}

// --- Cloud (OpenAI-compatible /audio/transcriptions) ------------------------

export interface CloudModel {
  id: string
  note: string
}

export interface CloudProvider {
  engine: 'openai' | 'groq'
  label: string
  baseUrl: string
  /** Key id in the encrypted vault. 'openai' is shared with the AI Summary OpenAI provider. */
  secretId: string
  /** Largest direct upload, in bytes. Both document "25 MB"; the decimal reading is the safe one. */
  maxUploadBytes: number
  models: readonly CloudModel[]
  defaultModel: string
}

// https://developers.openai.com/api/docs/guides/speech-to-text (gpt-transcribe is
// "the recommended model"), https://developers.openai.com/api/docs/deprecations
// (the other three are removed Feb 26, 2027), pricing page for "cheaper".
export const OPENAI: CloudProvider = {
  engine: 'openai',
  label: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  secretId: 'openai',
  maxUploadBytes: 25_000_000,
  models: [
    { id: 'gpt-transcribe', note: 'Recommended by OpenAI.' },
    { id: 'gpt-4o-mini-transcribe', note: 'Cheaper. OpenAI retires it on Feb 26, 2027.' },
    { id: 'gpt-4o-transcribe', note: 'OpenAI retires it on Feb 26, 2027.' },
    { id: 'whisper-1', note: 'The original Whisper API. OpenAI retires it on Feb 26, 2027.' }
  ],
  defaultModel: 'gpt-transcribe'
}

// https://console.groq.com/docs/speech-to-text, https://console.groq.com/docs/models
// (turbo $0.04/hr vs $0.111/hr for large-v3).
export const GROQ: CloudProvider = {
  engine: 'groq',
  label: 'Groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  secretId: 'groq',
  maxUploadBytes: 25_000_000,
  models: [
    { id: 'whisper-large-v3-turbo', note: 'Faster and cheaper.' },
    { id: 'whisper-large-v3', note: 'The full Large v3 model.' }
  ],
  defaultModel: 'whisper-large-v3-turbo'
}

export const CLOUD_PROVIDERS = { openai: OPENAI, groq: GROQ } as const
