// On-device model download — fetch a LOCAL_MODELS entry to ~/.meetvox/models,
// streaming with progress, hashing as it streams, checking the exact size and
// SHA-256 from the catalog, and moving it into place atomically (download to
// .part, then rename) so a failed/partial download never leaves a usable-looking
// file. On-device transcription is blocked until the chosen model is present.

import { createWriteStream, existsSync, mkdirSync, statSync, unlinkSync, renameSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { get as httpsGet } from 'https'
import type { IncomingMessage } from 'http'
import { localModelUrl, type LocalModel } from '@shared/transcription'
import type { ModelDownloadProgress } from '@shared/types'

export function modelDir(homeDir: string): string {
  return join(homeDir, '.meetvox', 'models')
}

export function modelFilePath(homeDir: string, file: string): string {
  return join(modelDir(homeDir), file)
}

export function computeFraction(received: number, total: number): number {
  return total > 0 ? received / total : -1
}

/** Null when the finished download matches the catalog, else the reason it doesn't. */
export function checkDownload(
  got: { bytes: number; sha256: string },
  model: LocalModel
): string | null {
  if (got.bytes !== model.bytes) {
    return `Model download incomplete: got ${got.bytes} of ${model.bytes} bytes`
  }
  if (got.sha256 !== model.sha256) return 'Model download is corrupt: SHA-256 does not match'
  return null
}

/** True if the model file exists at exactly its catalog size. */
export function isModelPresent(homeDir: string, model: LocalModel): boolean {
  const dest = modelFilePath(homeDir, model.file)
  if (!existsSync(dest)) return false
  try {
    return statSync(dest).size === model.bytes
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
  model: LocalModel
  onProgress?: (p: ModelDownloadProgress) => void
}

/** Download the model if missing. Resolves with the final path. Idempotent. */
export async function ensureModel(opts: DownloadOptions): Promise<string> {
  const { homeDir, model, onProgress } = opts
  const dest = modelFilePath(homeDir, model.file)
  if (isModelPresent(homeDir, model)) return dest

  mkdirSync(modelDir(homeDir), { recursive: true })
  const part = dest + '.part'
  if (existsSync(part)) unlinkSync(part) // never resume a stale partial

  const total = model.bytes
  const report = (p: Omit<ModelDownloadProgress, 'file' | 'totalBytes'>): void =>
    onProgress?.({ file: model.file, totalBytes: total, ...p })
  const removePart = (): void => {
    try {
      if (existsSync(part)) unlinkSync(part)
    } catch {
      /* ignore */
    }
  }

  const res = await getFollowingRedirects(localModelUrl(model.file), 5)
  const hash = createHash('sha256')
  let received = 0

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(part)
    const fail = (err: Error): void => {
      out.destroy()
      removePart()
      report({ receivedBytes: received, fraction: -1, done: false, error: err.message })
      reject(err)
    }

    res.on('data', (chunk: Buffer) => {
      received += chunk.length
      hash.update(chunk)
      report({
        receivedBytes: received,
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
  const problem = checkDownload({ bytes: written, sha256: hash.digest('hex') }, model)
  if (problem) {
    removePart()
    report({ receivedBytes: written, fraction: -1, done: false, error: problem })
    throw new Error(problem)
  }

  renameSync(part, dest) // atomic move into place
  report({ receivedBytes: written, fraction: 1, done: true, error: null })
  return dest
}
