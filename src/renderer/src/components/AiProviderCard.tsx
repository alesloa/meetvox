import { KeyRound, Terminal } from 'lucide-react'
import { ApiKeyField } from './ApiKeyField'
import type { ProviderConfig } from '@shared/types'

interface AiProviderCardProps {
  provider: ProviderConfig
  isDefault: boolean
  keySet: boolean
  /** For cli providers: whether the binary is on PATH. Ignored for API providers. */
  cliAvailable: boolean
  onUpdate: (patch: Partial<ProviderConfig>) => void
  onMakeDefault: () => void
  onSaveKey: (key: string) => Promise<void>
  onClearKey: () => Promise<void>
}

/** One configurable AI summary provider (enable / default / edit / key). */
export function AiProviderCard({
  provider,
  isDefault,
  keySet,
  cliAvailable,
  onUpdate,
  onMakeDefault,
  onSaveKey,
  onClearKey
}: AiProviderCardProps): JSX.Element {
  const isCli = provider.kind === 'cli'
  // A CLI provider that isn't installed can't be enabled.
  const blocked = isCli && !cliAvailable

  return (
    <div
      className={`rounded-lg border border-border bg-card p-4 ${blocked ? 'opacity-60' : ''}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {isCli ? (
            <Terminal className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate text-sm font-medium text-foreground">{provider.label}</span>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={provider.enabled}
            disabled={blocked}
            onChange={(e) => onUpdate({ enabled: e.target.checked })}
            className="h-3.5 w-3.5 accent-primary"
          />
          Enabled
        </label>
      </div>

      {/* Default radio — only meaningful for enabled providers. */}
      <label className="mt-2 flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
        <input
          type="radio"
          name="default-provider"
          checked={isDefault}
          disabled={blocked || !provider.enabled}
          onChange={onMakeDefault}
          className="h-3.5 w-3.5 accent-primary"
        />
        Use as default
      </label>

      {/* CLI body */}
      {isCli && (
        <div className="mt-3 space-y-2">
          <input
            type="text"
            aria-label="CLI command"
            value={(provider.command ?? []).join(' ')}
            spellCheck={false}
            onChange={(e) =>
              onUpdate({ command: e.target.value.split(' ').filter(Boolean) })
            }
            className="w-full rounded-md border border-border bg-input px-2 py-1 font-mono text-xs text-foreground outline-none focus:border-ring"
          />
          <p className="text-xs text-muted-foreground">
            {blocked
              ? `\`${provider.command?.[0] ?? provider.id}\` not found on PATH — install it and log in.`
              : 'Uses your CLI login — no API key needed.'}
          </p>
        </div>
      )}

      {/* API body */}
      {!isCli && (
        <div className="mt-3 space-y-2">
          <input
            type="text"
            value={provider.baseUrl ?? ''}
            spellCheck={false}
            placeholder="Base URL"
            onChange={(e) => onUpdate({ baseUrl: e.target.value })}
            className="w-full rounded-md border border-border bg-input px-2 py-1 font-mono text-xs text-foreground outline-none focus:border-ring"
          />
          <input
            type="text"
            value={provider.model ?? ''}
            spellCheck={false}
            placeholder="Model"
            onChange={(e) => onUpdate({ model: e.target.value })}
            className="w-full rounded-md border border-border bg-input px-2 py-1 font-mono text-xs text-foreground outline-none focus:border-ring"
          />

          <ApiKeyField keySet={keySet} onSaveKey={onSaveKey} onClearKey={onClearKey} />
        </div>
      )}
    </div>
  )
}
