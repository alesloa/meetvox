// Provider dispatcher: turn a prompt into summary text via one of three backends.
//
// SECURITY:
// - CLI providers receive the prompt on STDIN, never argv. argv leaks in `ps`
//   and has a length limit; the transcript would be both exposed and truncated.
//   CLI providers carry no key and no model — they ride the host `claude`/`codex`
//   login.
// - API providers read the key from the injected getSecret (safeStorage vault).
//   The key is used ONLY in the request header — never logged, never in a URL or
//   query string. The prompt/transcript body is never logged either.
// - A missing API key throws a clear error rather than sending a keyless request.

import type { ProviderConfig } from './types'

/** Generous ceiling for a detailed summary (Anthropic requires max_tokens). */
export const SUMMARY_MAX_TOKENS = 8192

export interface CompleteDeps {
  spawn: typeof import('child_process').spawn
  fetch: typeof fetch
  /** Already bound to userDataDir + safeStorage by the caller. */
  getSecret: (id: string) => string | null
}

/** Resolve a model string the API expects, or throw if absent. */
function requireModel(provider: ProviderConfig): string {
  if (!provider.model) {
    throw new Error(`No model configured for ${provider.id}`)
  }
  return provider.model
}

/** Read the stored key for an API provider, or throw a clear error. */
function requireKey(provider: ProviderConfig, deps: CompleteDeps): string {
  const key = deps.getSecret(provider.id)
  if (!key) throw new Error(`API key not set for ${provider.id}`)
  return key
}

/** Run a CLI provider: prompt → STDIN, summary ← STDOUT. */
function completeCli(provider: ProviderConfig, prompt: string, deps: CompleteDeps): Promise<string> {
  const command = provider.command
  if (!command || command.length === 0) {
    return Promise.reject(new Error(`No command configured for ${provider.id}`))
  }

  return new Promise((resolve, reject) => {
    // argv is command.slice(1) ONLY — the prompt is NEVER passed as an argument.
    const proc = deps.spawn(command[0], command.slice(1))
    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (d) => {
      stdout += d.toString()
    })
    proc.stderr?.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code !== 0) {
        // Include stderr (e.g. "not logged in"), NEVER the prompt.
        reject(new Error(`${command[0]} exited ${code}: ${stderr.trim().slice(-500)}`))
        return
      }
      resolve(stdout.trim())
    })

    // Suppress EPIPE: if the child exits before reading stdin (e.g. a CLI that
    // isn't logged in exits non-zero immediately), the write raises EPIPE on the
    // stream. Without this listener it becomes an uncaughtException that crashes
    // the main process. The promise is already settled by 'close'/'error'.
    proc.stdin?.on('error', () => {})
    // Send the prompt over stdin and close it so the child sees EOF.
    proc.stdin?.end(prompt)
  })
}

/** Call the Anthropic Messages API. */
async function completeAnthropic(
  provider: ProviderConfig,
  prompt: string,
  deps: CompleteDeps
): Promise<string> {
  const key = requireKey(provider, deps)
  const model = requireModel(provider)

  const res = await deps.fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: SUMMARY_MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    // status + body for diagnosis — the key is in the header, never echoed here.
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 500)}`)
  }

  const data = (await res.json()) as { content?: { text?: string }[] }
  const text = data.content?.[0]?.text ?? ''
  // A 200 with no text block means an unexpected shape — surface it instead of
  // silently writing an empty summary.
  if (!text) throw new Error('Anthropic API returned no summary text')
  return text
}

/** Call an OpenAI-compatible Chat Completions API. */
async function completeOpenAi(
  provider: ProviderConfig,
  prompt: string,
  deps: CompleteDeps
): Promise<string> {
  const key = requireKey(provider, deps)
  const model = requireModel(provider)
  if (!provider.baseUrl) throw new Error(`No baseUrl configured for ${provider.id}`)

  const res = await deps.fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }]
    })
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenAI API error ${res.status}: ${body.slice(0, 500)}`)
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const text = data.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error('OpenAI API returned no summary text')
  return text
}

/** Dispatch a prompt to the configured provider and return the summary text. */
export async function complete(
  provider: ProviderConfig,
  prompt: string,
  deps: CompleteDeps
): Promise<string> {
  switch (provider.kind) {
    case 'cli':
      return completeCli(provider, prompt, deps)
    case 'anthropic':
      return completeAnthropic(provider, prompt, deps)
    case 'openai-compatible':
      return completeOpenAi(provider, prompt, deps)
    default: {
      const exhaustive: never = provider.kind
      throw new Error(`Unknown provider kind: ${String(exhaustive)}`)
    }
  }
}
