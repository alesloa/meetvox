// Channel split — a faithful port of transcribe_meeting.py::split_stereo_to_mono.
// ffmpeg channelsplit -> left.wav + right.wav, resampled to 16 kHz mono pcm_s16le.
// INVARIANT: source chunk files are only read, never modified.

import { spawn } from 'child_process'
import { WHISPER_INPUT_RATE } from '@shared/constants'

export function buildSplitArgs(inputWav: string, leftOut: string, rightOut: string): string[] {
  const rate = String(WHISPER_INPUT_RATE)
  return [
    '-y',
    '-i',
    inputWav,
    '-filter_complex',
    '[0:a]channelsplit=channel_layout=stereo[left][right]',
    '-map',
    '[left]',
    '-ar',
    rate,
    '-c:a',
    'pcm_s16le',
    leftOut,
    '-map',
    '[right]',
    '-ar',
    rate,
    '-c:a',
    'pcm_s16le',
    rightOut
  ]
}

export function splitStereoToMono(
  ffmpegPath: string,
  inputWav: string,
  leftOut: string,
  rightOut: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, buildSplitArgs(inputWav, leftOut, rightOut))
    let stderr = ''
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg channelsplit exited ${code}: ${stderr.trim().slice(-500)}`))
    })
  })
}
