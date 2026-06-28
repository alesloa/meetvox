import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { resolveAudioPath, getMeetingAudio } from './protocol'

describe('resolveAudioPath', () => {
  const root = '/r/recordings'

  test('maps a chunk under root', () => {
    expect(resolveAudioPath('/meeting_20260609_134949/chunk_001.wav', root)).toBe(
      '/r/recordings/meeting_20260609_134949/chunk_001.wav'
    )
  })

  test('decodes percent-encoded path segments', () => {
    expect(resolveAudioPath('/meeting_20260609_134949/chunk_001.wav'.replace(/_/g, '_'), root)).toBe(
      '/r/recordings/meeting_20260609_134949/chunk_001.wav'
    )
    // Encoded slash-free name round-trips.
    expect(resolveAudioPath('/%6D%65eting_x/chunk_001.wav', root)).toBe(
      '/r/recordings/meeting_x/chunk_001.wav'
    )
  })

  test('rejects traversal', () => {
    expect(resolveAudioPath('/../../etc/passwd', root)).toBeNull()
    expect(resolveAudioPath('/meeting_x/../../secret.wav', root)).toBeNull()
  })

  test('rejects encoded traversal', () => {
    expect(resolveAudioPath('/%2e%2e/%2e%2e/secret.wav', root)).toBeNull()
  })

  test('rejects non-wav', () => {
    expect(resolveAudioPath('/meeting_x/meta.json', root)).toBeNull()
    expect(resolveAudioPath('/meeting_x/transcript.json', root)).toBeNull()
  })

  test('rejects the root itself and bare slashes', () => {
    expect(resolveAudioPath('/', root)).toBeNull()
    expect(resolveAudioPath('', root)).toBeNull()
  })

  test('rejects a sibling dir that shares the root prefix', () => {
    // /r/recordings-evil must not be treated as inside /r/recordings.
    expect(resolveAudioPath('/../recordings-evil/x.wav', root)).toBeNull()
  })
})

describe('getMeetingAudio', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'meetvox-proto-'))
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  // Minimal mono 16-bit PCM WAV: header + `frames` samples → durationSec = frames/rate.
  function makeWav(frames: number, sampleRate = 16000): Buffer {
    const channels = 1
    const bytesPerSample = 2
    const dataLen = frames * channels * bytesPerSample
    const buf = Buffer.alloc(44 + dataLen)
    buf.write('RIFF', 0, 'ascii')
    buf.writeUInt32LE(36 + dataLen, 4)
    buf.write('WAVE', 8, 'ascii')
    buf.write('fmt ', 12, 'ascii')
    buf.writeUInt32LE(16, 16)
    buf.writeUInt16LE(1, 20)
    buf.writeUInt16LE(channels, 22)
    buf.writeUInt32LE(sampleRate, 24)
    buf.writeUInt32LE(sampleRate * channels * bytesPerSample, 28)
    buf.writeUInt16LE(channels * bytesPerSample, 32)
    buf.writeUInt16LE(16, 34)
    buf.write('data', 36, 'ascii')
    buf.writeUInt32LE(dataLen, 40)
    return buf
  }

  function makeMeeting(name: string): string {
    const dir = join(tmpRoot, name)
    mkdirSync(dir)
    return dir
  }

  test('returns chunk sources in ascending order with per-chunk + total durations', () => {
    const name = 'meeting_20260609_134949'
    const dir = makeMeeting(name)
    // Out-of-order write; sorted-by-name output expected.
    writeFileSync(join(dir, 'chunk_002.wav'), makeWav(16000)) // 1.0s
    writeFileSync(join(dir, 'chunk_000.wav'), makeWav(8000)) // 0.5s
    writeFileSync(join(dir, 'chunk_001.wav'), makeWav(32000)) // 2.0s
    writeFileSync(join(dir, 'transcript.json'), '{}') // ignored
    writeFileSync(join(dir, 'meta.json'), '{}') // ignored

    const res = getMeetingAudio(dir)
    expect(res.sources).toEqual([
      `meetvox-audio://meeting/${encodeURIComponent(name)}/chunk_000.wav`,
      `meetvox-audio://meeting/${encodeURIComponent(name)}/chunk_001.wav`,
      `meetvox-audio://meeting/${encodeURIComponent(name)}/chunk_002.wav`
    ])
    expect(res.durations).toEqual([0.5, 2, 1])
    expect(res.durationSec).toBe(3.5)
  })

  test('source URL pathname round-trips back through resolveAudioPath', () => {
    const name = 'meeting_20260609_134949'
    const dir = makeMeeting(name)
    writeFileSync(join(dir, 'chunk_000.wav'), makeWav(16000))
    const [src] = getMeetingAudio(dir).sources
    const pathname = new URL(src).pathname
    expect(resolveAudioPath(pathname, tmpRoot)).toBe(join(dir, 'chunk_000.wav'))
  })

  test('falls back to any *.wav when no chunk_NNN files exist', () => {
    const dir = makeMeeting('meeting_import')
    writeFileSync(join(dir, 'recording.wav'), makeWav(16000))
    const res = getMeetingAudio(dir)
    expect(res.sources).toEqual([
      `meetvox-audio://meeting/${encodeURIComponent('meeting_import')}/recording.wav`
    ])
    expect(res.durations).toEqual([1])
    expect(res.durationSec).toBe(1)
  })

  test('returns empty result when no wav files exist', () => {
    const dir = makeMeeting('meeting_empty')
    writeFileSync(join(dir, 'transcript.json'), '{}')
    const res = getMeetingAudio(dir)
    expect(res.sources).toEqual([])
    expect(res.durations).toEqual([])
    expect(res.durationSec).toBe(0)
  })
})
