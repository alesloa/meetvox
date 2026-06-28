// whisper.cpp transcription — replaces the HTTP `transcribe_audio` call in
// transcribe_meeting.py. Spawns the bundled `whisper-cli` per job (model loaded by
// the process, RAM reclaimed on exit), parses plain-text output, filters blank
// markers exactly as the Python did.
//
// Output mode: `-nt` (no timestamps) prints the transcription as plain text with
// no `[timestamp]` prefixes. whisper-cli emits the whole channel as effectively a
// single line, so parseWhisperOutput just strips the surrounding whitespace and
// drops blank-only output. (A build that ignores `-nt` and still emits
// `[HH:MM:SS.mmm --> ...]` prefixes is handled too: those prefixes are stripped
// per line.)
//
// NOTE: this intentionally does NOT byte-reproduce the old Python whisper-server
// `text` field — that server used a different model (medium.en) and its own
// segmentation/decoding, so exact word/segment parity is not achievable. The
// faithful-port guarantees are the file format, channel→speaker mapping, silence
// skip and merge; the exact words depend on the configured model (large-v3-q5_0).

import { spawn } from 'child_process'
import { BLANK_MARKERS } from '@shared/constants'

const TIMESTAMP_PREFIX = /^\s*\[\s*\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}\s*\]/

/** Parse whisper-cli stdout into the final channel text (or '' when blank). */
export function parseWhisperOutput(stdout: string): string {
  const segments: string[] = []
  for (const raw of stdout.split('\n')) {
    let line = raw.replace(/\r$/, '')
    const m = line.match(TIMESTAMP_PREFIX)
    if (m) line = line.slice(m[0].length)
    if (line.trim() === '') continue
    segments.push(line)
  }
  const text = segments.join('\n').trim()
  if (text === '' || (BLANK_MARKERS as readonly string[]).includes(text)) return ''
  return text
}

export interface WhisperOptions {
  whisperPath: string
  modelPath: string
  wavPath: string
  /** Whisper language; Python used 'auto'. */
  language?: string
}

/** Spawn whisper-cli on a 16 kHz mono wav and return the parsed transcript text. */
export function transcribe(opts: WhisperOptions): Promise<string> {
  const { whisperPath, modelPath, wavPath, language = 'auto' } = opts
  return new Promise((resolve, reject) => {
    const args = ['-m', modelPath, '-f', wavPath, '-l', language, '-nt']
    const proc = spawn(whisperPath, args)
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d) => {
      stdout += d.toString()
    })
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`whisper-cli exited ${code}: ${stderr.trim().slice(-500)}`))
        return
      }
      resolve(parseWhisperOutput(stdout))
    })
  })
}
