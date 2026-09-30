import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join, basename } from 'path'
import { processMeeting, runPipeline, type PipelineRunners } from './pipeline'
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
