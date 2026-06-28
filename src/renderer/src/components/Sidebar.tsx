import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Mic, List, Upload, Settings, ChevronLeft, ChevronRight, ChevronDown, Trash2 } from 'lucide-react'
import { useRouter } from '../app/router'
import type { NavAction, Route } from '../app/router'
import { useMeetings } from '../app/meetings'
import { useSettings } from '../app/settings'
import { fmtMeetingTime, groupByRecency } from '../lib/format'

interface NavItem {
  label: string
  icon: ReactNode
  action: NavAction
  matchView: Route['view']
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Record', icon: <Mic className="h-5 w-5" />, action: { type: 'home' }, matchView: 'home' },
  { label: 'Library', icon: <List className="h-5 w-5" />, action: { type: 'library' }, matchView: 'library' },
  { label: 'Import', icon: <Upload className="h-5 w-5" />, action: { type: 'import' }, matchView: 'import' },
  { label: 'Settings', icon: <Settings className="h-5 w-5" />, action: { type: 'settings' }, matchView: 'settings' },
]

export function Sidebar(): JSX.Element {
  const [expanded, setExpanded] = useState(true)
  // Whole "Meetings" section collapse + per-recency-group collapse. Session-local
  // (resets on relaunch); the sidebar width is the only collapse state persisted.
  const [meetingsOpen, setMeetingsOpen] = useState(true)
  const [closedGroups, setClosedGroups] = useState<Record<string, boolean>>({})
  const seededRef = useRef(false)
  const { route, navigate } = useRouter()
  const { meetings, refresh } = useMeetings()
  const { settings, save } = useSettings()

  // Bucket meetings into Today / Yesterday / Previous 7 Days / … by createdAt.
  // Recomputed only when the list changes; day-granular `now` is fine to re-read.
  const groups = useMemo(() => groupByRecency(meetings, new Date()), [meetings])
  const toggleGroup = (key: string): void =>
    setClosedGroups((c) => ({ ...c, [key]: !c[key] }))

  // Seed the collapsed state from persisted settings, once, on first load.
  useEffect(() => {
    if (!settings || seededRef.current) return
    seededRef.current = true
    setExpanded(!settings.sidebarCollapsed)
  }, [settings])

  const toggle = (): void => {
    setExpanded((v) => {
      const next = !v
      void save({ sidebarCollapsed: !next }).catch(() => {})
      return next
    })
  }

  const handleDelete = useCallback(
    async (e: React.MouseEvent, dir: string, name: string) => {
      e.stopPropagation()
      const confirmed = window.confirm(
        `Delete "${name}"?\n\nThis permanently removes the recording, audio, and transcript. This cannot be undone.`
      )
      if (!confirmed) return
      try {
        await window.meetvox.deleteMeeting(dir)
        if (route.view === 'meeting' && route.meetingDir === dir) navigate({ type: 'home' })
        await refresh()
      } catch (err) {
        console.error('Delete failed:', err)
      }
    },
    [route, navigate, refresh]
  )

  const width = expanded ? '256px' : '64px'

  return (
    <aside
      className="no-drag flex h-full shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200"
      style={{ width }}
    >
      {/* Nav items */}
      <nav className="flex flex-col gap-1 px-2 pt-2">
        {NAV_ITEMS.map((item) => {
          const active = route.view === item.matchView
          return (
            <button
              key={item.label}
              title={item.label}
              onClick={() => navigate(item.action)}
              className={`no-drag flex w-full items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              }`}
            >
              <span className="shrink-0">{item.icon}</span>
              {expanded && <span className="truncate">{item.label}</span>}
            </button>
          )
        })}
      </nav>

      {/* Meeting list (expanded only) */}
      {expanded ? (
        <div className="custom-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
          {/* "Meetings" header — chevron collapses the whole section. The Library
              nav item above is still the single entry point to the full view. */}
          <button
            onClick={() => setMeetingsOpen((v) => !v)}
            title={meetingsOpen ? 'Hide meetings' : 'Show meetings'}
            className="no-drag flex w-full items-center gap-1 rounded-md px-2 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 transition-transform ${
                meetingsOpen ? '' : '-rotate-90'
              }`}
            />
            <span>Meetings</span>
            {meetings.length > 0 && <span className="ml-auto tabular-nums">{meetings.length}</span>}
          </button>

          {meetingsOpen && meetings.length === 0 && (
            <p className="px-2 py-1 text-xs italic text-muted-foreground">No meetings yet</p>
          )}

          {meetingsOpen &&
            groups.map((g) => {
              const open = !closedGroups[g.key]
              return (
                <div key={g.key} className="flex flex-col">
                  {/* Date-group header — indented one level right of "Meetings".
                      Chevron collapses just this group. */}
                  <button
                    onClick={() => toggleGroup(g.key)}
                    title={open ? `Hide ${g.label}` : `Show ${g.label}`}
                    className="no-drag mt-1 flex w-full items-center gap-1 rounded-md py-1 pl-4 pr-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <ChevronDown
                      className={`h-3 w-3 shrink-0 transition-transform ${open ? '' : '-rotate-90'}`}
                    />
                    <span className="truncate">{g.label}</span>
                    <span className="ml-auto tabular-nums opacity-60">{g.items.length}</span>
                  </button>

                  {/* Leaf meetings — indented another level under the group header,
                      with a vertical guide line so the hierarchy reads as a tree. */}
                  {open && (
                    <div className="ml-5 flex flex-col border-l border-border/60 pl-1.5">
                      {g.items.map((m) => {
                        const active = route.view === 'meeting' && route.meetingDir === m.dir
                        return (
                          <div key={m.dir} className="group relative flex items-center">
                            <button
                              title={m.name}
                              onClick={() => navigate({ type: 'openMeeting', dir: m.dir })}
                              className={`no-drag flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 pr-7 text-left transition-colors ${
                                active
                                  ? 'bg-accent text-accent-foreground'
                                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                              }`}
                            >
                              <span className="w-full truncate text-sm font-medium">{m.name}</span>
                              <span className="w-full truncate text-xs opacity-70">
                                {fmtMeetingTime(m.createdAt)}
                              </span>
                            </button>
                            <button
                              title="Delete meeting"
                              onClick={(e) => handleDelete(e, m.dir, m.name)}
                              className="no-drag absolute right-1 rounded p-0.5 text-transparent transition-colors group-hover:text-red-500 hover:bg-red-500/10 hover:!text-red-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
        </div>
      ) : (
        <div className="flex-1" />
      )}

      {/* Collapse toggle */}
      <div className="px-2 pb-3">
        <button
          title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          onClick={toggle}
          className="no-drag flex w-full items-center justify-start rounded-lg px-2 py-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          {expanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  )
}
