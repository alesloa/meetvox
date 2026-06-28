// Silence detection — a faithful port of transcribe_meeting.py::get_audio_level.
// Runs `ffmpeg -i <wav> -af volumedetect -f null -`, parses `max_volume:` from
// stderr (peak detection is better for speech than mean). Channels at or below
// -50 dB are treated as silent and skipped.

import { spawn } from 'child_process'
import { SILENCE_DEFAULT_DB, SILENCE_THRESHOLD_DB } from '@shared/constants'

/** Parse the `max_volume: <n> dB` line from ffmpeg stderr. Defaults to -100 (Python). */
export function parseMaxVolume(stderr: string): number {
  for (const line of stderr.split('\n')) {
    const idx = line.indexOf('max_volume:')
    if (idx === -1) continue
    const after = line.slice(idx + 'max_volume:'.length).trim()
    const token = after.split(/\s+/)[0]
    if (token === '-inf') return -Infinity
    if (token === 'inf' || token === '+inf') return Infinity
    const val = Number(token)
    if (Number.isNaN(val)) return SILENCE_DEFAULT_DB
    return val
  }
  return SILENCE_DEFAULT_DB
}

/** A channel is silent when its peak is NOT above the threshold (Python: `level > threshold`). */
export function isSilent(maxVolumeDb: number): boolean {
  return !(maxVolumeDb > SILENCE_THRESHOLD_DB)
}

/** Run ffmpeg volumedetect on a wav and return its peak level in dB. */
export function getAudioLevel(ffmpegPath: string, wavPath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-i', wavPath, '-af', 'volumedetect', '-f', 'null', '-'])
    let stderr = ''
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('error', () => resolve(SILENCE_DEFAULT_DB))
    proc.on('close', () => resolve(parseMaxVolume(stderr)))
  })
}
