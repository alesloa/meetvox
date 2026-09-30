import { useState } from 'react'
import { Check, Trash2 } from 'lucide-react'
import { ipcErrorText } from '../lib/ipcError'

interface ApiKeyFieldProps {
  keySet: boolean
  onSaveKey: (key: string) => Promise<void>
  onClearKey: () => Promise<void>
}

/** Store / replace / remove an encrypted API key. Never shows a stored key value. */
export function ApiKeyField({ keySet, onSaveKey, onClearKey }: ApiKeyFieldProps): JSX.Element {
  const [keyDraft, setKeyDraft] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)
  const [keyBusy, setKeyBusy] = useState(false)

  const run = async (action: () => Promise<void>): Promise<void> => {
    setKeyBusy(true)
    setKeyError(null)
    try {
      await action()
    } catch (e) {
      setKeyError(ipcErrorText(e))
    } finally {
      setKeyBusy(false)
    }
  }

  const saveKey = (): Promise<void> =>
    run(async () => {
      const value = keyDraft.trim()
      if (!value) return
      await onSaveKey(value)
      setKeyDraft('')
      setReplacing(false)
    })

  return (
    <div className="space-y-2">
      {keySet && !replacing ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-rec-green" /> API key stored
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setReplacing(true)}
              disabled={keyBusy}
              className="rounded px-1.5 py-0.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
            >
              Replace
            </button>
            <button
              title="Remove stored key"
              aria-label="Remove stored key"
              onClick={() => void run(onClearKey)}
              disabled={keyBusy}
              className="rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={keyDraft}
            placeholder="API key"
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setKeyDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveKey()
            }}
            className="min-w-0 flex-1 rounded-md border border-border bg-input px-2 py-1 text-xs text-foreground outline-none focus:border-ring"
          />
          <button
            onClick={() => void saveKey()}
            disabled={keyBusy || !keyDraft.trim()}
            className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
          >
            Save key
          </button>
        </div>
      )}
      {keyError && <p className="text-xs text-destructive">{keyError}</p>}
    </div>
  )
}
