// First-run model download — fetch ggml-large-v3-q5_0.bin (1.08 GB) to
// ~/.meetvox/models, streaming with progress, validating the size, and moving it
// into place atomically (download to .part, then rename) so a failed/partial
// download never leaves a usable-looking file. Transcribe is blocked until the
// model is present.

import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync, renameSync } from 'fs'
import { join } from 'path'
import { get as httpsGet } from 'https'
import type { IncomingMessage } from 'http'
import { MODEL_FILENAME, MODEL_URL, MODEL_EXPECTED_BYTES } from '@shared/constants'
import type { ModelDownloadProgress } from '@shared/types'

export function modelDir(homeDir: string): string {
  return join(homeDir, '.meetvox', 'models')
}

export function modelFilePath(homeDir: string): string {
  return join(modelDir(homeDir), MODEL_FILENAME)
}

export function computeFraction(received: number, total: number): number {
  return total > 0 ? received / total : -1
}

/** Sanity floor for a completed download (size matches content-length, or large enough). */
export function sizeLooksComplete(written: number, contentLength: number): boolean {
  if (contentLength > 0) return written === contentLength
  // Unknown content length: require at least half the expected model size.
  return written >= MODEL_EXPECTED_BYTES / 2
}

/** True if the model file already exists and is not obviously truncated. */
export function isModelPresent(homeDir: string): boolean {
  const dest = modelFilePath(homeDir)
  if (!existsSync(dest)) return false
  try {
    return statSync(dest).size >= MODEL_EXPECTED_BYTES / 2
  } catch {
    return false
  }
}

/** GET following HTTP redirects (HuggingFace `resolve` 302s to a CDN). */
function getFollowingRedirects(url: string, redirectsLeft: number): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, (res) => {
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume() // drain
        if (redirectsLeft <= 0) {
          reject(new Error('Too many redirects while downloading the model'))
          return
        }
        const next = new URL(res.headers.location, url).toString()
        resolve(getFollowingRedirects(next, redirectsLeft - 1))
        return
      }
      if (status !== 200) {
        res.resume()
        reject(new Error(`Model download failed: HTTP ${status}`))
        return
      }
      resolve(res)
    })
    req.on('error', reject)
  })
}

export interface DownloadOptions {
  homeDir: string
  onProgress?: (p: ModelDownloadProgress) => void
}

/** Download the model if missing. Resolves with the final path. Idempotent. */
export async function ensureModel(opts: DownloadOptions): Promise<string> {
  const { homeDir, onProgress } = opts
  const dest = modelFilePath(homeDir)
  if (isModelPresent(homeDir)) return dest

  mkdirSync(modelDir(homeDir), { recursive: true })
  const part = dest + '.part'
  if (existsSync(part)) unlinkSync(part) // never resume a stale partial

  const res = await getFollowingRedirects(MODEL_URL, 5)
  const total = Number(res.headers['content-length'] ?? -1)
  let received = 0

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(part)
    const fail = (err: Error): void => {
      out.destroy()
      try {
        if (existsSync(part)) unlinkSync(part)
      } catch {
        /* ignore */
      }
      onProgress?.({ receivedBytes: received, totalBytes: total, fraction: -1, done: false, error: err.message })
      reject(err)
    }

    res.on('data', (chunk: Buffer) => {
      received += chunk.length
      onProgress?.({
        receivedBytes: received,
        totalBytes: total,
        fraction: computeFraction(received, total),
        done: false,
        error: null
      })
    })
    res.on('error', fail)
    out.on('error', fail)
    out.on('finish', () => resolve())
    res.pipe(out)
  })

  const written = statSync(part).size
  if (!sizeLooksComplete(written, total)) {
    try {
      unlinkSync(part)
    } catch {
      /* ignore */
    }
    const msg = `Model download incomplete (${written} bytes)`
    onProgress?.({ receivedBytes: written, totalBytes: total, fraction: -1, done: false, error: msg })
    throw new Error(msg)
  }

  renameSync(part, dest) // atomic move into place
  onProgress?.({
    receivedBytes: written,
    totalBytes: total,
    fraction: 1,
    done: true,
    error: null
  })
  return dest
}
