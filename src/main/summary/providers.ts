import type { ProviderConfig, SummaryConfig } from './types'

/**
 * Factory provider presets shipped with the app.
 * All disabled by default — the user enables one and supplies credentials (API key
 * or CLI login) in Settings.  CLI providers use the host's `claude`/`codex` login
 * so they carry no key and no model string.  API model strings are editable
 * defaults visible in the Settings field.
 */
export const PRESETS: ProviderConfig[] = [
  {
    id: 'claude-cli',
    label: 'Claude Code CLI',
    kind: 'cli',
    enabled: false,
    command: ['claude', '-p'],
    model: null,
  },
  {
    id: 'codex-cli',
    label: 'Codex CLI',
    kind: 'cli',
    enabled: false,
    command: ['codex', 'exec'],
    model: null,
  },
  {
    id: 'anthropic',
    label: 'Claude API',
    kind: 'anthropic',
    enabled: false,
    baseUrl: 'https://api.anthropic.com',
    model: 'claude-sonnet-4-6',
  },
  {
    id: 'openai',
    label: 'OpenAI API',
    kind: 'openai-compatible',
    enabled: false,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o',
  },
]

/**
 * Return the provider to use for this summary run.
 *
 * Resolution order:
 * 1. `defaultProviderId` if it names an existing, enabled provider.
 * 2. First enabled provider in the list.
 * 3. `null` when none are enabled.
 */
export function pick(config: SummaryConfig): ProviderConfig | null {
  const { providers, defaultProviderId } = config

  if (defaultProviderId !== null) {
    const explicit = providers.find(
      (p) => p.id === defaultProviderId && p.enabled,
    )
    if (explicit) return explicit
  }

  return providers.find((p) => p.enabled) ?? null
}
