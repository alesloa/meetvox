import { useEffect } from 'react'
import { AudioLines } from 'lucide-react'
import { useRouter } from './app/router'
import { useSettings } from './app/settings'
import { useTheme } from './app/theme'
import { Sidebar } from './components/Sidebar'
import { HomeView } from './views/HomeView'
import { MeetingView } from './views/MeetingView'
import { LibraryView } from './views/LibraryView'
import { SettingsView } from './views/SettingsView'
import { ImportView } from './views/ImportView'

/** Applies the persisted theme preference once settings load. */
function ThemeBootstrap(): null {
  const { settings } = useSettings()
  const { setPref } = useTheme()
  useEffect(() => {
    if (settings) setPref(settings.theme)
  }, [settings, setPref])
  return null
}

/** Routes the renderer when the tray's Settings/Open items fire. Cleans up on unmount. */
function TrayNavigation(): null {
  const { navigate } = useRouter()
  useEffect(() => {
    const off = window.meetvox.onTrayNavigate((view) => navigate({ type: view }))
    return off
  }, [navigate])
  return null
}

export default function App(): JSX.Element {
  const { route } = useRouter()

  let view: JSX.Element
  switch (route.view) {
    case 'home':
      view = <HomeView />
      break
    case 'meeting':
      view = <MeetingView meetingDir={route.meetingDir} />
      break
    case 'library':
      view = <LibraryView />
      break
    case 'import':
      view = <ImportView />
      break
    case 'settings':
      view = <SettingsView />
      break
    default: {
      // Exhaustiveness guard: adding a Route variant without a case becomes a compile error.
      const _exhaustive: never = route
      view = <HomeView />
      void _exhaustive
    }
  }

  // macOS uses a frameless window (hiddenInset), so the traffic lights overlay the
  // top-left. Inset the logo past them on mac; Windows/Linux keep a native frame and
  // need no inset. navigator.platform is synchronous, so there's no first-paint flash.
  const isMac = navigator.platform.startsWith('Mac')

  return (
    <div className="flex h-full flex-col bg-background">
      <ThemeBootstrap />
      <TrayNavigation />
      {/* Full-width draggable title bar — keeps the traffic lights off the content. */}
      <header
        className={`titlebar flex h-11 shrink-0 items-center gap-2 bg-card pr-4 ${
          isMac ? 'pl-20' : 'pl-4'
        }`}
      >
        <AudioLines className="h-4 w-4 shrink-0 text-rec-green" />
        <span className="truncate text-sm font-semibold tracking-tight text-foreground">
          Meetvox
        </span>
      </header>
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">{view}</div>
      </div>
    </div>
  )
}
