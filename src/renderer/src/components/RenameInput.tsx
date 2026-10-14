import { useRef, useState } from 'react'

interface RenameInputProps {
  name: string
  onDone: (next: string | null) => void
  className: string
}

/**
 * Inline name field. Enter or clicking away saves, Escape cancels. `onDone` gets the
 * new name, or null when nothing changed (cancelled, empty, or the same name).
 */
export function RenameInput({ name, onDone, className }: RenameInputProps): JSX.Element {
  const [draft, setDraft] = useState(name)
  // Blur is the single commit point; Escape sets this so its blur cancels instead.
  const cancelled = useRef(false)
  return (
    <input
      autoFocus
      value={draft}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const next = draft.trim()
        onDone(cancelled.current || !next || next === name ? null : next)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault()
          cancelled.current = e.key === 'Escape'
          e.currentTarget.blur()
        }
      }}
      className={className}
    />
  )
}
