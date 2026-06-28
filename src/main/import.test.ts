import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join, basename } from 'path'
import { importFolder, importFile, transcribeSingleTrack } from './import'
import { encodeChunk } from './audio/wav'
import { SPEAKER_NEUTRAL, WHISPER_INPUT_RATE } from '@shared/constants'

let srcRoot: string
let destRoot: string

// A real 1-second stereo chunk so readWavDuration returns a known duration.
function writeChunk(path: string, seconds: number): void {
  const n = Math.round(44100 * seconds)
  const mic = new Float32Array(n).fill(0.5)
  const system = new Float32Array(n * 2).fill(0.5)
  const out = encodeChunk({ mic, system, systemChannels: 2, sampleRate: 44100 })
  writeFileSync(path, Buffer.from(out.wav!))
}

beforeEach(() => {
  srcRoot = mkdtempSync(join(tmpdir(), 'meetvox-import-src-'))
  destRoot = mkdtempSync(join(tmpdir(), 'meetvox-import-dest-'))
})
afterEach(() => {
  rmSync(srcRoot, { recursive: true, force: true })
  rmSync(destRoot, { recursive: true, force: true })
})

const FIXED = new Date('2026-06-09T13:49:49')

describe('importFolder', () => {
  it('rejects a directory with no chunk_*.wav', () => {
    writeFileSync(join(srcRoot, 'notes.txt'), 'hi')
    expect(() => importFolder(srcRoot, destRoot, FIXED)).toThrow(/chunk/i)
  })

  it('creates meeting_<ts>, copies chunks (originals intact), writes channelMapped meta', () => {
    writeChunk(join(srcRoot, 'chunk_001.wav'), 1)
    writeChunk(join(srcRoot, 'chunk_002.wav'), 1)

    const { meetingDir, channelMapped } = importFolder(srcRoot, destRoot, FIXED)

    // folder name from fixed `now`
    expect(basename(meetingDir)).toBe('meeting_20260609_134949')
    expect(channelMapped).toBe(true)

    // chunks copied into the new dir
    expect(existsSync(join(meetingDir, 'chunk_001.wav'))).toBe(true)
    expect(existsSync(join(meetingDir, 'chunk_002.wav'))).toBe(true)

    // originals still present — never moved/deleted
    expect(existsSync(join(srcRoot, 'chunk_001.wav'))).toBe(true)
    expect(existsSync(join(srcRoot, 'chunk_002.wav'))).toBe(true)

    const meta = JSON.parse(readFileSync(join(meetingDir, 'meta.json'), 'utf8'))
    expect(meta.source).toBe('imported')
    expect(meta.channelMapped).toBe(true)
    expect(meta.name).toBe(basename(srcRoot))
    expect(meta.durationSec).toBeCloseTo(2, 1) // two 1s chunks summed
    expect(meta.createdAt).toBe(FIXED.toISOString())
  })
})

describe('importFile', () => {
  it('spawns ffmpeg with the expected decode args and writes channelMapped:false meta', async () => {
    const srcFile = join(srcRoot, 'talk.mp3')
    writeFileSync(srcFile, 'fake mp3 bytes') // never read by us; ffmpeg is mocked

    let captured: { cmd: string; args: string[] } | null = null
    const fakeSpawn = (cmd: string, args: string[]): EventEmitter => {
      captured = { cmd, args }
      const proc = new EventEmitter()
      // emit close(0) on the next tick so the awaiter resolves
      setImmediate(() => proc.emit('close', 0))
      return proc
    }

    const { meetingDir, channelMapped } = await importFile(srcFile, destRoot, FIXED, {
      spawn: fakeSpawn as never,
      ffmpegPath: '/bundled/ffmpeg'
    })

    expect(channelMapped).toBe(false)
    expect(basename(meetingDir)).toBe('meeting_20260609_134949')

    const dest = join(meetingDir, 'audio.wav')
    expect(captured!.cmd).toBe('/bundled/ffmpeg')
    expect(captured!.args).toEqual([
      '-y',
      '-i',
      srcFile,
      '-ac',
      '1',
      '-ar',
      String(WHISPER_INPUT_RATE),
      '-c:a',
      'pcm_s16le',
      dest
    ])

    // original file untouched
    expect(existsSync(srcFile)).toBe(true)
    expect(readFileSync(srcFile, 'utf8')).toBe('fake mp3 bytes')

    const meta = JSON.parse(readFileSync(join(meetingDir, 'meta.json'), 'utf8'))
    expect(meta.source).toBe('imported')
    expect(meta.channelMapped).toBe(false)
    expect(meta.createdAt).toBe(FIXED.toISOString())
  })

  it('rejects when ffmpeg exits non-zero and removes the partial folder', async () => {
    const srcFile = join(srcRoot, 'bad.mp3')
    writeFileSync(srcFile, 'x')
    const fakeSpawn = (): EventEmitter => {
      const proc = new EventEmitter()
      setImmediate(() => proc.emit('close', 1))
      return proc
    }
    await expect(
      importFile(srcFile, destRoot, FIXED, { spawn: fakeSpawn as never, ffmpegPath: '/f' })
    ).rejects.toThrow(/ffmpeg/i)
    // The half-created meeting folder must not linger after a failed decode.
    expect(existsSync(join(destRoot, 'meeting_20260609_134949'))).toBe(false)
    // The source file is untouched.
    expect(existsSync(srcFile)).toBe(true)
  })

  it('rejects when the source file does not exist', async () => {
    const fakeSpawn = (): EventEmitter => new EventEmitter()
    await expect(
      importFile(join(srcRoot, 'missing.mp3'), destRoot, FIXED, {
        spawn: fakeSpawn as never,
        ffmpegPath: '/f'
      })
    ).rejects.toThrow(/not found/i)
  })
})

describe('transcribeSingleTrack', () => {
  it('writes exactly one neutral-Speaker entry for non-empty text', async () => {
    const meetingDir = join(destRoot, 'meeting_20260609_134949')
    mkdirSync(meetingDir, { recursive: true })
    const wavPath = join(meetingDir, 'audio.wav')

    await transcribeSingleTrack(meetingDir, wavPath, {
      transcribe: async () => 'hello world',
      now: () => FIXED
    })

    const json = JSON.parse(readFileSync(join(meetingDir, 'transcript.json'), 'utf8'))
    expect(json).toEqual([{ time: 0, speaker: SPEAKER_NEUTRAL, text: 'hello world' }])
    // SPEAKER_NEUTRAL is 'Speaker', never You/Other
    expect(json[0].speaker).toBe('Speaker')
    expect(json[0].speaker).not.toBe('You')
    expect(json[0].speaker).not.toBe('Other')

    const txt = readFileSync(join(meetingDir, 'transcript.txt'), 'utf8')
    expect(txt).toContain('Speaker:')
    expect(txt).toContain('hello world')
    expect(txt).toContain(`# Meeting Transcript: ${basename(meetingDir)}`)
  })

  it('writes an empty-entries transcript when transcribe returns empty', async () => {
    const meetingDir = join(destRoot, 'meeting_empty')
    mkdirSync(meetingDir, { recursive: true })
    const wavPath = join(meetingDir, 'audio.wav')

    await transcribeSingleTrack(meetingDir, wavPath, {
      transcribe: async () => '',
      now: () => FIXED
    })

    const json = JSON.parse(readFileSync(join(meetingDir, 'transcript.json'), 'utf8'))
    expect(json).toEqual([])
  })
})
