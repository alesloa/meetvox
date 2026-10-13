import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, basename } from 'path'
import { processMeeting, runPipeline, type PipelineRunners } from './pipeline'
import { PROGRESS_FILE, readProgress, savePiece } from './progress'
import { encodeChunk } from '../audio/wav'

let dir: string

// Build a real 1-second stereo chunk so readWavDuration returns a known duration.
function writeChunk(path: string, seconds: number): void {
  const n = Math.round(44100 * seconds)
  const mic = new Float32Array(n).fill(0.5)
  const system = new Float32Array(n * 2).fill(0.5)
  const out = encodeChunk({ mic, system, systemChannels: 2, sampleRate: 44100 })
  writeFileSync(path, Buffer.from(out.wav!))
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'meetvox-pipe-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('processMeeting — orchestration (faithful to process_meeting)', () => {
  it('builds entries with correct time/speaker, skipping silent channels, sorted by (time, speaker)', async () => {
    writeChunk(join(dir, 'chunk_001.wav'), 1)
    writeChunk(join(dir, 'chunk_002.wav'), 1)

    // chunk 1: left loud + right silent ; chunk 2: left silent + right loud
    const levels: Record<string, number> = {}
    const runners: PipelineRunners = {
      split: async (_input, left, right) => {
        // remember which physical chunk this split came from via the temp name index
        const isChunk1 = _input.endsWith('chunk_001.wav')
        levels[left] = isChunk1 ? -10 : -80 // left loud only in chunk1
        levels[right] = isChunk1 ? -80 : -10 // right loud only in chunk2
        writeFileSync(left, 'x')
        writeFileSync(right, 'x')
      },
      level: async (wav) => levels[wav] ?? -100,
      transcribe: async (wav) => (levels[wav] > -50 ? 'spoken text' : '')
    }

    const entries = await processMeeting(dir, runners)
    // duration ~1s, chunk1 -> You@0, chunk2 -> Other@~1
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ speaker: 'You' })
    expect(entries[0].time).toBeCloseTo(0, 6)
    expect(entries[1]).toMatchObject({ speaker: 'Other' })
    expect(entries[1].time).toBeGreaterThan(0.9)
    expect(entries[1].text).toBe('spoken text')
  })

  it('throws when there are no chunk files', async () => {
    const runners: PipelineRunners = {
      split: async () => {},
      level: async () => -100,
      transcribe: async () => ''
    }
    await expect(processMeeting(dir, runners)).rejects.toThrow(/no chunk/i)
  })

  it('drops blank-marker and empty transcriptions (keeps only real text)', async () => {
    writeChunk(join(dir, 'chunk_001.wav'), 1)
    const runners: PipelineRunners = {
      split: async (_i, left, right) => {
        writeFileSync(left, 'x')
        writeFileSync(right, 'x')
      },
      level: async () => -10, // both "loud"
      transcribe: async (wav) => (wav.includes('left') ? 'real' : '') // right returns empty
    }
    const entries = await processMeeting(dir, runners)
    expect(entries).toEqual([{ time: 0, speaker: 'You', text: 'real' }])
  })
})

/** Runners where only the left (You) channel speaks; records each chunk it transcribed. */
function recordingRunners(transcribed: string[]): PipelineRunners {
  return {
    split: async (input, left, right) => {
      writeFileSync(left, basename(input))
      writeFileSync(right, basename(input))
    },
    level: async () => -10,
    transcribe: async (wav) => {
      if (!wav.includes('left')) return ''
      const chunk = readFileSync(wav, 'utf8')
      transcribed.push(chunk)
      return `text of ${chunk}`
    }
  }
}

describe('processMeeting — stop, continue, start over', () => {
  beforeEach(() => {
    writeChunk(join(dir, 'chunk_000.wav'), 1)
    writeChunk(join(dir, 'chunk_001.wav'), 1)
  })

  it('saves each finished piece to the progress file', async () => {
    await processMeeting(dir, recordingRunners([]))
    expect(Object.keys(readProgress(dir))).toEqual(['chunk_000.wav', 'chunk_001.wav'])
    expect(readProgress(dir)['chunk_000.wav']).toEqual([
      { time: 0, speaker: 'You', text: 'text of chunk_000.wav' }
    ])
  })

  it('continue skips the saved pieces and keeps their text', async () => {
    savePiece(dir, 'chunk_000.wav', [{ time: 0, speaker: 'You', text: 'saved earlier' }])
    const transcribed: string[] = []
    const entries = await processMeeting(dir, recordingRunners(transcribed), { resume: true })
    expect(transcribed).toEqual(['chunk_001.wav'])
    expect(entries.map((e) => e.text)).toEqual(['saved earlier', 'text of chunk_001.wav'])
  })

  it('start over ignores and replaces the saved pieces', async () => {
    savePiece(dir, 'chunk_000.wav', [{ time: 0, speaker: 'You', text: 'saved earlier' }])
    const transcribed: string[] = []
    const entries = await processMeeting(dir, recordingRunners(transcribed))
    expect(transcribed).toEqual(['chunk_000.wav', 'chunk_001.wav'])
    expect(entries.map((e) => e.text)).not.toContain('saved earlier')
  })

  it('a stop rejects, keeps the finished pieces, and writes no transcript', async () => {
    const stop = new AbortController()
    const runners = recordingRunners([])
    const transcribe = runners.transcribe
    runners.transcribe = async (wav, signal) => {
      if (readFileSync(wav, 'utf8') === 'chunk_001.wav') {
        stop.abort()
        signal?.throwIfAborted()
      }
      return transcribe(wav, signal)
    }
    await expect(runPipeline(dir, runners, { signal: stop.signal })).rejects.toThrow()
    expect(Object.keys(readProgress(dir))).toEqual(['chunk_000.wav'])
    expect(existsSync(join(dir, 'transcript.json'))).toBe(false)
  })

  it('passes the stop signal to the engine', async () => {
    const stop = new AbortController()
    const seen: (AbortSignal | undefined)[] = []
    const runners = recordingRunners([])
    runners.transcribe = async (_wav, signal) => {
      seen.push(signal)
      return ''
    }
    await processMeeting(dir, runners, { signal: stop.signal })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((s) => s === stop.signal)).toBe(true)
  })

  it('runPipeline deletes the progress file once the transcript is written', async () => {
    await runPipeline(dir, recordingRunners([]))
    expect(existsSync(join(dir, 'transcript.json'))).toBe(true)
    expect(existsSync(join(dir, PROGRESS_FILE))).toBe(false)
  })
})

describe('runPipeline — writes transcript.txt + transcript.json, merged', () => {
  it('writes both files into the meeting dir and returns their paths', async () => {
    writeChunk(join(dir, 'chunk_001.wav'), 1)
    const runners: PipelineRunners = {
      split: async (_i, left, right) => {
        writeFileSync(left, 'x')
        writeFileSync(right, 'x')
      },
      level: async () => -10,
      transcribe: async (wav) => (wav.includes('left') ? 'hello' : '')
    }
    const res = await runPipeline(dir, runners, { now: () => new Date('2026-06-09T14:10:35') })
    expect(existsSync(res.txtPath)).toBe(true)
    expect(existsSync(res.jsonPath)).toBe(true)

    const txt = readFileSync(res.txtPath, 'utf8')
    expect(txt).toContain(`# Meeting Transcript: ${basename(dir)}`)
    expect(txt).toContain('# Generated: 2026-06-09 14:10:35')

    const json = JSON.parse(readFileSync(res.jsonPath, 'utf8'))
    expect(Array.isArray(json)).toBe(true)
    expect(json[0]).toMatchObject({ speaker: 'You', text: 'hello' })
  })

  it('names the engine in its progress messages', async () => {
    writeChunk(join(dir, 'chunk_001.wav'), 1)
    const runners: PipelineRunners = {
      split: async (_i, left, right) => {
        writeFileSync(left, 'x')
        writeFileSync(right, 'x')
      },
      level: async () => -10,
      transcribe: async () => 'hi'
    }
    const messages: string[] = []
    await runPipeline(dir, runners, {
      engineLabel: 'Groq (whisper-large-v3-turbo)',
      onProgress: (p) => messages.push(p.message)
    })
    expect(messages).toEqual([
      'Processing chunk 1/1 with Groq (whisper-large-v3-turbo)',
      'Transcribed 2 segments with Groq (whisper-large-v3-turbo)'
    ])
  })
})
