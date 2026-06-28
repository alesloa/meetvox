import { useEffect, useRef, useState } from 'react'

interface NotesEditorProps {
  meetingDir: string
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const DEBOUNCE_MS = 600
const SAVED_CLEAR_MS = 1500

export function NotesEditor({ meetingDir }: NotesEditorProps): JSX.Element {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<SaveStatus>('idle')

  // Cancelled flag for load effect; debounce timer ref.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  // Only blur-saves when there's an actual unsaved edit (avoids a spurious write
  // of unchanged text when the user just tabs through the Notes field).
  const dirtyRef = useRef(false)

  // Track mounted state for setState-after-unmount guard.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Load notes whenever meetingDir changes. Cancel in-flight on cleanup.
  useEffect(() => {
    let cancelled = false

    // Reset state immediately so prior meeting's text doesn't bleed.
    setText('')
    setStatus('idle')
    dirtyRef.current = false

    // Clear any pending debounce from prior meeting so we don't save A's text into B.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (savedTimerRef.current) {
      clearTimeout(savedTimerRef.current)
      savedTimerRef.current = null
    }

    window.meetvox
      .getNotes({ dir: meetingDir })
      .then((notes) => {
        if (cancelled) return
        setText(notes)
      })
      .catch(() => {
        // Load failure: leave textarea empty, don't crash.
      })

    return () => {
      cancelled = true
    }
  }, [meetingDir])

  // Cleanup debounce on unmount.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    }
  }, [])

  const doSave = (dir: string, value: string): void => {
    if (!mountedRef.current) return
    // The value is now being persisted — fresh edits during the save re-set this.
    dirtyRef.current = false
    setStatus('saving')
    window.meetvox
      .saveNotes({ dir, text: value })
      .then(() => {
        if (!mountedRef.current) return
        setStatus('saved')
        savedTimerRef.current = setTimeout(() => {
          if (mountedRef.current) setStatus('idle')
        }, SAVED_CLEAR_MS)
      })
      .catch(() => {
        if (!mountedRef.current) return
        setStatus('error')
      })
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const value = e.target.value
    setText(value)
    dirtyRef.current = true

    // Reset debounce timer.
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null
      doSave(meetingDir, value)
    }, DEBOUNCE_MS)
  }

  const handleBlur = (): void => {
    // Flush debounce immediately on blur.
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    // Only write if there's an actual unsaved edit.
    if (dirtyRef.current) doSave(meetingDir, text)
  }

  const statusLabel =
    status === 'saving'
      ? 'Saving…'
      : status === 'saved'
        ? 'Saved'
        : status === 'error'
          ? "Couldn't save"
          : null

  return (
    <div className="flex h-full flex-col">
      <textarea
        className="custom-scrollbar min-h-0 flex-1 resize-none bg-card p-4 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none select-text"
        style={{ userSelect: 'text' }}
        placeholder="Write notes for this meeting…"
        value={text}
        onChange={handleChange}
        onBlur={handleBlur}
        spellCheck
      />
      {statusLabel && (
        <div
          className={`shrink-0 border-t border-border px-4 py-1 text-xs ${
            status === 'error' ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          {statusLabel}
        </div>
      )}
    </div>
  )
}
