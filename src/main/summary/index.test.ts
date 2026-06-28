import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { generateSummary, getSummary } from './index'
import { saveSettings, type SecretStorage } from '../settings'
import { PRESETS } from './providers'
import { SUMMARY_CHAR_BUDGET } from './prompt'
import type { TranscriptEntry } from '@shared/types'

let meetingDir: string
let userDataDir: string

// Fake crypto backend — Electron safeStorage isn't available under vitest.
const storage: SecretStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from('enc:' + s),
  decryptString: (b) => b.toString().replace('enc:', '')
}

const neverSpawn = (() => {
  throw new Error('spawn must not be called')
}) as unknown as typeof import('child_process').spawn

const neverFetch = (() => {
  throw new Error('fetch must not be called')
}) as unknown as typeof fetch

const NOW = new Date('2026-06-09T13:49:49.000Z')

function writeTranscript(entries: TranscriptEntry[]): void {
  writeFileSync(join(meetingDir, 'transcript.json'), JSON.stringify(entries))
}

// Enable a CLI provider (no key needed) as the default.
function enableCliProvider(): void {
  const claudeCli = PRESETS.find((p) => p.id === 'claude-cli')!
  saveSettings(userDataDir, {
    summary: { providers: [{ ...claudeCli, enabled: true }], defaultProviderId: 'claude-cli' }
  })
}

// Enable the anthropic API provider as the default.
function enableAnthropicProvider(): void {
  const anthropic = PRESETS.find((p) => p.id === 'anthropic')!
  saveSettings(userDataDir, {
    summary: { providers: [{ ...anthropic, enabled: true }], defaultProviderId: 'anthropic' }
  })
}

// A spawn that captures stdin and replies with a per-call canned stdout.
function cliSpawn(reply: (stdin: string, callIndex: number) => string): {
  spawn: typeof import('child_process').spawn
  prompts: string[]
} {
  const prompts: string[] = []
  const spawn = (() => {
    const { EventEmitter } = require('events')
    const child = new EventEmitter()
    let stdinData = ''
    // stdin is an EventEmitter (so .on('error') exists, like a real stream) + .end.
    child.stdin = Object.assign(new EventEmitter(), {
      end: (data: string): void => {
        stdinData = data
        prompts.push(data)
        const out = reply(stdinData, prompts.length - 1)
        setImmediate(() => {
          child.stdout.emit('data', Buffer.from(out))
          child.emit('close', 0)
        })
      }
    })
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    return child
  }) as unknown as typeof import('child_process').spawn
  return { spawn, prompts }
}

beforeEach(() => {
  meetingDir = mkdtempSync(join(tmpdir(), 'meetvox-summary-meeting-'))
  userDataDir = mkdtempSync(join(tmpdir(), 'meetvox-summary-userdata-'))
})

afterEach(() => {
  rmSync(meetingDir, { recursive: true, force: true })
  rmSync(userDataDir, { recursive: true, force: true })
})

describe('generateSummary — guard clauses', () => {
  it('throws when transcript.json is absent', async () => {
    enableCliProvider()
    await expect(
      generateSummary({
        meetingDir,
        userDataDir,
        storage,
        spawn: neverSpawn,
        fetch: neverFetch,
        now: () => NOW
      })
    ).rejects.toThrow(/No transcript/i)
  })

  it('throws when transcript is empty', async () => {
    enableCliProvider()
    writeTranscript([])
    await expect(
      generateSummary({
        meetingDir,
        userDataDir,
        storage,
        spawn: neverSpawn,
        fetch: neverFetch,
        now: () => NOW
      })
    ).rejects.toThrow(/No transcript/i)
  })

  it('throws when no provider is enabled', async () => {
    writeTranscript([{ time: 0, speaker: 'You', text: 'hi' }])
    await expect(
      generateSummary({
        meetingDir,
        userDataDir,
        storage,
        spawn: neverSpawn,
        fetch: neverFetch,
        now: () => NOW
      })
    ).rejects.toThrow(/provider/i)
  })

  it('throws a clear error when the API provider has no stored key', async () => {
    enableAnthropicProvider()
    writeTranscript([{ time: 0, speaker: 'You', text: 'hi' }])
    await expect(
      generateSummary({
        meetingDir,
        userDataDir,
        storage,
        spawn: neverSpawn,
        fetch: neverFetch,
        now: () => NOW
      })
    ).rejects.toThrow(/key/i)
  })
})

describe('generateSummary — single-pass (CLI)', () => {
  it('summarizes a short transcript in one call and writes summary.json', async () => {
    enableCliProvider()
    writeTranscript([
      { time: 0, speaker: 'You', text: 'Shall we ship Friday?' },
      { time: 1, speaker: 'Other', text: 'Yes, after QA.' }
    ])
    const { spawn, prompts } = cliSpawn(() => 'THE SUMMARY')

    const summary = await generateSummary({
      meetingDir,
      userDataDir,
      storage,
      spawn,
      fetch: neverFetch,
      now: () => NOW
    })

    expect(prompts).toHaveLength(1) // single pass, no map-reduce
    expect(summary.text).toBe('THE SUMMARY')
    expect(summary.provider).toBe('claude-cli')
    expect(summary.model).toBeNull()
    expect(summary.generatedAt).toBe(NOW.toISOString())

    // summary.json was written and round-trips via getSummary.
    const path = join(meetingDir, 'summary.json')
    expect(existsSync(path)).toBe(true)
    const onDisk = JSON.parse(readFileSync(path, 'utf8'))
    expect(onDisk.text).toBe('THE SUMMARY')
    expect(getSummary(meetingDir)).toEqual(summary)
  })

  it('passes the real transcript text into the prompt (no mock/fake summary)', async () => {
    enableCliProvider()
    writeTranscript([{ time: 0, speaker: 'You', text: 'UNIQUE-MARKER-TEXT' }])
    const { spawn, prompts } = cliSpawn(() => 'ok')

    await generateSummary({
      meetingDir,
      userDataDir,
      storage,
      spawn,
      fetch: neverFetch,
      now: () => NOW
    })
    expect(prompts[0]).toContain('UNIQUE-MARKER-TEXT')
    expect(prompts[0]).toContain('You: UNIQUE-MARKER-TEXT')
  })
})

describe('generateSummary — map-reduce (long transcript)', () => {
  it('summarizes each chunk, then combines the partial summaries into one', async () => {
    enableCliProvider()
    // Build a transcript whose rendered prompt exceeds the char budget so
    // needsMapReduce triggers. Each entry ~ (budget/2 + slack) chars → 3 chunks.
    const big = 'x'.repeat(Math.floor(SUMMARY_CHAR_BUDGET * 0.6))
    writeTranscript([
      { time: 0, speaker: 'You', text: big },
      { time: 1, speaker: 'Other', text: big },
      { time: 2, speaker: 'You', text: big }
    ])

    // Per-chunk calls return SECTION-<n>; the final combine call returns FINAL.
    const seen: string[] = []
    const { spawn, prompts } = cliSpawn((stdin) => {
      // The final combine prompt is the one that contains our section markers.
      if (stdin.includes('SECTION-0') || stdin.includes('SECTION-1')) {
        return 'FINAL'
      }
      const idx = seen.length
      seen.push(stdin)
      return `SECTION-${idx}`
    })

    const summary = await generateSummary({
      meetingDir,
      userDataDir,
      storage,
      spawn,
      fetch: neverFetch,
      now: () => NOW
    })

    // 3 chunk calls + 1 combine call.
    expect(prompts.length).toBe(4)
    // The final prompt contains the section summaries to combine.
    const finalPrompt = prompts[prompts.length - 1]
    expect(finalPrompt).toContain('SECTION-0')
    expect(finalPrompt).toContain('SECTION-1')
    expect(finalPrompt).toContain('SECTION-2')
    expect(summary.text).toBe('FINAL')
  })
})

describe('getSummary', () => {
  it('returns null when summary.json is absent', () => {
    expect(getSummary(meetingDir)).toBeNull()
  })

  it('returns null for a malformed summary.json (no throw)', () => {
    writeFileSync(join(meetingDir, 'summary.json'), '{ not json ')
    expect(() => getSummary(meetingDir)).not.toThrow()
    expect(getSummary(meetingDir)).toBeNull()
  })

  it('parses a valid cached summary', () => {
    const summary = {
      text: 'S',
      provider: 'claude-cli',
      model: null,
      generatedAt: NOW.toISOString()
    }
    writeFileSync(join(meetingDir, 'summary.json'), JSON.stringify(summary))
    expect(getSummary(meetingDir)).toEqual(summary)
  })
})
