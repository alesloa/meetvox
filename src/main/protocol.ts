// Custom `meetvox-audio://` protocol: serves recorded chunk WAVs to the renderer's
// <audio> element. The handler is the load-bearing security boundary — it serves
// ONLY *.wav files that resolve to a real path strictly inside recordingsRoot.
// URL shape: meetvox-audio://meeting/<meetingFolderName>/<file.wav>
//   host = literal "meeting"; the folder name (with underscores) lives in the PATH.

import { protocol, net } from 'electron'
import { resolve, sep, join, basename } from 'path'
import { existsSync, readdirSync, openSync, readSync, closeSync, statSync } from 'fs'
import { pathToFileURL } from 'url'
import { readWavDuration } from './audio/wav'
import type { MeetingAudio } from '@shared/types'

// Enough bytes to reach the `data` chunk header in any sane WAV, so we read the
// header (not the multi-MB audio body) just to compute a chunk's duration.
const WAV_HEADER_MAX = 65536

/** Read just the leading header bytes of a WAV — duration comes from the declared
 *  `data` chunk size, so the body never needs to be loaded. */
function readWavHeaderBuffer(path: string): Buffer {
  const size = Math.min(statSync(path).size, WAV_HEADER_MAX)
  const buf = Buffer.alloc(size)
  const fd = openSync(path, 'r')
  try {
    readSync(fd, buf, 0, size, 0)
  } finally {
    closeSync(fd)
  }
  return buf
}

/**
 * Map a meetvox-audio URL pathname to a real .wav path strictly inside `root`,
 * or null if the request is unsafe (traversal, escape, or non-.wav).
 */
export function resolveAudioPath(pathname: string, root: string): string | null {
  let rel: string
  try {
    rel = decodeURIComponent(pathname)
  } catch {
    // Malformed percent-encoding → reject.
    return null
  }
  rel = rel.replace(/^\/+/, '') // strip leading slashes; resolve() treats them as absolute otherwise
  if (rel === '') return null

  const abs = resolve(root, rel)

  // Must be strictly inside root (the `+ sep` guards against a sibling like
  // `<root>-evil` that shares the root string prefix) and never the root dir itself.
  if (abs === root || !abs.startsWith(root + sep)) return null
  if (!abs.toLowerCase().endsWith('.wav')) return null

  return abs
}

/** Register the privileged `meetvox-audio` handler. Call once, inside app.whenReady.
 *  `getRoot` is read per request so a live recordings-folder switch keeps serving
 *  files from the current root (the guard always reflects ctx.recordingsRoot). */
export function registerAudioProtocol(getRoot: () => string): void {
  protocol.handle('meetvox-audio', async (request) => {
    const { pathname } = new URL(request.url)
    const file = resolveAudioPath(pathname, getRoot())
    if (!file || !existsSync(file)) return new Response(null, { status: 404 })

    // net.fetch on a file:// URL streams the body and honors HTTP Range requests,
    // which the <audio> element requires to seek. We copy the response and force
    // Content-Type: audio/wav so the renderer decodes it correctly. A fetch
    // rejection (e.g. the file vanished after the existsSync check) becomes a 500
    // rather than an unhandled rejection in the main process.
    try {
      const upstream = await net.fetch(pathToFileURL(file).toString())
      const headers = new Headers(upstream.headers)
      headers.set('Content-Type', 'audio/wav')
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers
      })
    } catch {
      return new Response(null, { status: 500 })
    }
  })
}

/**
 * Scan a meeting dir for playable WAVs. Prefers `chunk_NNN.wav` (recorded
 * sessions) ascending; falls back to any `*.wav` for single-file imports.
 * No invented filenames — sources come from a real readdir of `dir`.
 */
export function getMeetingAudio(dir: string): MeetingAudio {
  const all = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.wav'))
  const chunks = all.filter((n) => /^chunk_\d{3}\.wav$/i.test(n)).sort()
  const files = chunks.length > 0 ? chunks : all.sort()

  const folder = basename(dir)
  const sources: string[] = []
  const durations: number[] = []

  for (const file of files) {
    const { durationSec } = readWavDuration(readWavHeaderBuffer(join(dir, file)))
    durations.push(durationSec)
    sources.push(
      `meetvox-audio://meeting/${encodeURIComponent(folder)}/${encodeURIComponent(file)}`
    )
  }

  const totalSec = durations.reduce((a, b) => a + b, 0)
  return { sources, durations, durationSec: totalSec }
}
