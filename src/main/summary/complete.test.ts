import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'events'
import { complete, SUMMARY_MAX_TOKENS, type CompleteDeps } from './complete'
import type { ProviderConfig } from './types'

// A fake child process whose stdin.end captures what was written, and whose
// stdout/stderr/close are driven by the test. Mirrors the EventEmitter pattern
// used in import.test.ts.
class FakeChild extends EventEmitter {
  // stdin is an EventEmitter (so .on('error') exists, like a real stream) plus .end.
  stdin = Object.assign(new EventEmitter(), {
    end: (data?: string): void => {
      this.stdinData = data
    }
  })
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  stdinData: string | undefined = undefined
}

function makeCliProvider(command: string[]): ProviderConfig {
  return { id: 'claude-cli', label: 'Claude CLI', kind: 'cli', enabled: true, command, model: null }
}

// A spawn that returns a FakeChild and drives stdout 'SUMMARY' + close(code).
function spawnFactory(opts: {
  stdout?: string
  stderr?: string
  code?: number
  emitError?: Error
}): { spawn: typeof import('child_process').spawn; calls: { cmd: string; args: string[] }[]; child: FakeChild } {
  const calls: { cmd: string; args: string[] }[] = []
  const child = new FakeChild()
  const spawn = ((cmd: string, args: string[]) => {
    calls.push({ cmd, args })
    setImmediate(() => {
      if (opts.emitError) {
        child.emit('error', opts.emitError)
        return
      }
      if (opts.stdout) child.stdout.emit('data', Buffer.from(opts.stdout))
      if (opts.stderr) child.stderr.emit('data', Buffer.from(opts.stderr))
      child.emit('close', opts.code ?? 0)
    })
    return child
  }) as unknown as typeof import('child_process').spawn
  return { spawn, calls, child }
}

// A getSecret that returns a fixed value (or null).
function getSecret(value: string | null): (id: string) => string | null {
  return () => value
}

const neverSpawn = (() => {
  throw new Error('spawn must not be called in this test')
}) as unknown as typeof import('child_process').spawn

const neverFetch = (() => {
  throw new Error('fetch must not be called in this test')
}) as unknown as typeof fetch

// ── kind: cli ────────────────────────────────────────────────────────────────

describe('complete — cli', () => {
  it('writes the PROMPT to stdin (NOT argv) and resolves trimmed stdout', async () => {
    const { spawn, calls, child } = spawnFactory({ stdout: '  SUMMARY  ', code: 0 })
    const deps: CompleteDeps = { spawn, fetch: neverFetch, getSecret: getSecret(null) }
    const prompt = 'SECRET TRANSCRIPT BODY that must never appear in argv'

    const result = await complete(makeCliProvider(['claude', '-p']), prompt, deps)

    expect(result).toBe('SUMMARY')
    // The binary is command[0]; argv is command.slice(1) ONLY.
    expect(calls).toHaveLength(1)
    expect(calls[0].cmd).toBe('claude')
    expect(calls[0].args).toEqual(['-p'])
    // The prompt must NOT be anywhere in argv (leaks in `ps`).
    expect(calls[0].args).not.toContain(prompt)
    expect(calls[0].args.join(' ')).not.toContain('TRANSCRIPT')
    // The prompt reached stdin, and stdin was ended.
    expect(child.stdinData).toBe(prompt)
  })

  it('rejects with stderr (not the prompt) on non-zero exit', async () => {
    const { spawn } = spawnFactory({ stderr: 'not logged in', code: 1 })
    const deps: CompleteDeps = { spawn, fetch: neverFetch, getSecret: getSecret(null) }
    const prompt = 'PROMPT-DO-NOT-LEAK'

    const err = await complete(makeCliProvider(['claude', '-p']), prompt, deps).then(
      () => null,
      (e: Error) => e
    )
    expect(err).toBeInstanceOf(Error)
    expect(err!.message).toContain('not logged in')
    expect(err!.message).not.toContain('PROMPT-DO-NOT-LEAK')
  })

  it('rejects on spawn error', async () => {
    const { spawn } = spawnFactory({ emitError: new Error('ENOENT') })
    const deps: CompleteDeps = { spawn, fetch: neverFetch, getSecret: getSecret(null) }
    await expect(complete(makeCliProvider(['claude', '-p']), 'p', deps)).rejects.toThrow(/ENOENT/)
  })
})

// ── kind: anthropic ──────────────────────────────────────────────────────────

const anthropicProvider: ProviderConfig = {
  id: 'anthropic',
  label: 'Claude API',
  kind: 'anthropic',
  enabled: true,
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-sonnet-4-6'
}

interface FetchCall {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

function fetchFactory(opts: {
  ok?: boolean
  status?: number
  json?: unknown
  text?: string
}): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: (init.headers as Record<string, string>) ?? {},
      body: JSON.parse(init.body as string)
    })
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: async () => opts.json,
      text: async () => opts.text ?? ''
    } as Response
  }) as unknown as typeof fetch
  return { fetch: fakeFetch, calls }
}

describe('complete — anthropic', () => {
  it('POSTs the messages endpoint with x-api-key + version + body shape, returns content[0].text', async () => {
    const { fetch, calls } = fetchFactory({ ok: true, json: { content: [{ text: 'S' }] } })
    const deps: CompleteDeps = { spawn: neverSpawn, fetch, getSecret: getSecret('sk-ant-XYZ') }

    const result = await complete(anthropicProvider, 'the prompt', deps)

    expect(result).toBe('S')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
    expect(calls[0].headers['x-api-key']).toBe('sk-ant-XYZ')
    expect(calls[0].headers['anthropic-version']).toBe('2023-06-01')
    expect(calls[0].headers['content-type']).toBe('application/json')
    expect(calls[0].body.model).toBe('claude-sonnet-4-6')
    expect(calls[0].body.max_tokens).toBe(SUMMARY_MAX_TOKENS)
    expect(calls[0].body.messages).toEqual([{ role: 'user', content: 'the prompt' }])
  })

  it('throws a clear "API key not set" error when getSecret returns null (no request sent)', async () => {
    const { fetch, calls } = fetchFactory({ ok: true, json: { content: [{ text: 'S' }] } })
    const deps: CompleteDeps = { spawn: neverSpawn, fetch, getSecret: getSecret(null) }

    await expect(complete(anthropicProvider, 'p', deps)).rejects.toThrow(/key/i)
    // No keyless request leaks out.
    expect(calls).toHaveLength(0)
  })

  it('throws with status + body but never the key when res.ok is false', async () => {
    const { fetch } = fetchFactory({ ok: false, status: 401, text: 'unauthorized' })
    const deps: CompleteDeps = { spawn: neverSpawn, fetch, getSecret: getSecret('sk-ant-SECRET') }

    const err = await complete(anthropicProvider, 'p', deps).then(
      () => null,
      (e: Error) => e
    )
    expect(err).toBeInstanceOf(Error)
    expect(err!.message).toContain('401')
    expect(err!.message).toContain('unauthorized')
    expect(err!.message).not.toContain('sk-ant-SECRET')
  })

  it('throws on a 200 with no text block instead of returning an empty summary', async () => {
    const { fetch } = fetchFactory({ ok: true, json: { content: [] } })
    const deps: CompleteDeps = { spawn: neverSpawn, fetch, getSecret: getSecret('sk-ant-XYZ') }
    await expect(complete(anthropicProvider, 'p', deps)).rejects.toThrow(/no summary text/i)
  })
})

// ── kind: openai-compatible ──────────────────────────────────────────────────

const openaiProvider: ProviderConfig = {
  id: 'openai',
  label: 'OpenAI API',
  kind: 'openai-compatible',
  enabled: true,
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o'
}

describe('complete — openai-compatible', () => {
  it('POSTs ${baseUrl}/chat/completions with Bearer auth and returns choices[0].message.content', async () => {
    const { fetch, calls } = fetchFactory({
      ok: true,
      json: { choices: [{ message: { content: 'S' } }] }
    })
    const deps: CompleteDeps = { spawn: neverSpawn, fetch, getSecret: getSecret('sk-oai-XYZ') }

    const result = await complete(openaiProvider, 'the prompt', deps)

    expect(result).toBe('S')
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions')
    expect(calls[0].headers['Authorization']).toBe('Bearer sk-oai-XYZ')
    expect(calls[0].headers['content-type']).toBe('application/json')
    expect(calls[0].body.model).toBe('gpt-4o')
    expect(calls[0].body.messages).toEqual([{ role: 'user', content: 'the prompt' }])
  })

  it('throws when no key is stored (no request sent)', async () => {
    const { fetch, calls } = fetchFactory({ ok: true, json: {} })
    const deps: CompleteDeps = { spawn: neverSpawn, fetch, getSecret: getSecret(null) }
    await expect(complete(openaiProvider, 'p', deps)).rejects.toThrow(/key/i)
    expect(calls).toHaveLength(0)
  })

  it('throws with status + body but never the key on non-ok response', async () => {
    const { fetch } = fetchFactory({ ok: false, status: 500, text: 'server error' })
    const deps: CompleteDeps = { spawn: neverSpawn, fetch, getSecret: getSecret('sk-oai-SECRET') }
    const err = await complete(openaiProvider, 'p', deps).then(
      () => null,
      (e: Error) => e
    )
    expect(err!.message).toContain('500')
    expect(err!.message).toContain('server error')
    expect(err!.message).not.toContain('sk-oai-SECRET')
  })
})
