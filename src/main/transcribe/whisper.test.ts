import { describe, it, expect } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { parseWhisperOutput, transcribe } from './whisper'

describe('transcribe — reads whisper-cli stdout', () => {
  it.skipIf(process.platform === 'win32')(
    'keeps a UTF-8 character that arrives split across two reads',
    async () => {
      const dir = mkdtempSync(join(tmpdir(), 'meetvox-whisper-'))
      try {
        // "été": the first é is \303\251. Send \303 alone, pause, then the rest.
        const fake = join(dir, 'fake-whisper')
        writeFileSync(fake, "#!/bin/sh\nprintf '\\303'\nsleep 0.2\nprintf '\\251t\\303\\251\\n'\n")
        chmodSync(fake, 0o755)
        const text = await transcribe({ whisperPath: fake, modelPath: 'm.bin', wavPath: 'a.wav' })
        expect(text).toBe('été')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    }
  )

  it.skipIf(process.platform === 'win32')('a stop kills whisper-cli right away', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'meetvox-whisper-'))
    try {
      const fake = join(dir, 'slow-whisper')
      writeFileSync(fake, '#!/bin/sh\nexec sleep 30\n')
      chmodSync(fake, 0o755)
      const stop = new AbortController()
      const started = Date.now()
      const run = transcribe({ whisperPath: fake, modelPath: 'm.bin', wavPath: 'a.wav', signal: stop.signal })
      setTimeout(() => stop.abort(), 100)
      await expect(run).rejects.toThrow()
      expect(Date.now() - started).toBeLessThan(5000)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('parseWhisperOutput — normalizes whisper-cli output into the channel text', () => {
  it('passes real -nt output (a single line) through, trimmed', () => {
    // Verified against whisper-cli v1.7.4: `-nt` emits the whole channel as ONE
    // line (no per-segment newlines). We just strip the surrounding whitespace.
    const stdout = " Okay, let's go over the plan for next week. Sounds good."
    expect(parseWhisperOutput(stdout)).toBe(
      "Okay, let's go over the plan for next week. Sounds good."
    )
  })

  it('joins multi-line input with newline and strips the outer whitespace', () => {
    // Defensive path: if a build emits one segment per line, keep them separated.
    const stdout = [
      " Okay, let's go over the plan for next week.",
      ' The new feature is on track for the demo.',
      " I'll send out the notes after this call."
    ].join('\n')
    expect(parseWhisperOutput(stdout)).toBe(
      "Okay, let's go over the plan for next week.\n" +
        ' The new feature is on track for the demo.\n' +
        " I'll send out the notes after this call."
    )
  })

  it('strips [HH:MM:SS.mmm --> HH:MM:SS.mmm] prefixes if a build emits them', () => {
    const stdout =
      '[00:00:00.000 --> 00:00:04.000]   hello there\n' +
      '[00:00:04.000 --> 00:00:08.000]   general kenobi'
    expect(parseWhisperOutput(stdout)).toContain('hello there')
    expect(parseWhisperOutput(stdout)).toContain('general kenobi')
    expect(parseWhisperOutput(stdout)).not.toContain('-->')
  })

  it('returns empty string when the whole output is a blank marker', () => {
    expect(parseWhisperOutput(' [BLANK_AUDIO]')).toBe('')
    expect(parseWhisperOutput('[ Silence ]')).toBe('')
    expect(parseWhisperOutput('(silence)')).toBe('')
    expect(parseWhisperOutput('')).toBe('')
    expect(parseWhisperOutput('   \n  \n')).toBe('')
  })

  it('keeps an internal blank marker when there is also real speech (Python only drops exact matches)', () => {
    const stdout = ' Yeah, I will see it.\n [BLANK_AUDIO]'
    expect(parseWhisperOutput(stdout)).toBe('Yeah, I will see it.\n [BLANK_AUDIO]')
  })

  it('ignores carriage returns and blank lines between segments', () => {
    const stdout = ' one\r\n\r\n two\r\n'
    expect(parseWhisperOutput(stdout)).toBe('one\n two')
  })
})
