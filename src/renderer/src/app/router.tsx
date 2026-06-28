import React, { createContext, useContext, useReducer } from 'react'

export type Route =
  | { view: 'home' }
  | { view: 'meeting'; meetingDir: string }
  | { view: 'library' }
  | { view: 'import' }
  | { view: 'settings' }

export type NavAction =
  | { type: 'home' }
  | { type: 'library' }
  | { type: 'import' }
  | { type: 'settings' }
  | { type: 'openMeeting'; dir: string }

export function navReduce(state: Route, action: NavAction): Route {
  switch (action.type) {
    case 'home':
      return { view: 'home' }
    case 'library':
      return { view: 'library' }
    case 'import':
      return { view: 'import' }
    case 'settings':
      return { view: 'settings' }
    case 'openMeeting':
      return { view: 'meeting', meetingDir: action.dir }
    default:
      return state
  }
}

interface RouterContextValue {
  route: Route
  navigate: (action: NavAction) => void
}

const RouterContext = createContext<RouterContextValue | null>(null)

export function RouterProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [route, dispatch] = useReducer(navReduce, { view: 'home' })
  return (
    <RouterContext.Provider value={{ route, navigate: dispatch }}>
      {children}
    </RouterContext.Provider>
  )
}

export function useRouter(): RouterContextValue {
  const ctx = useContext(RouterContext)
  if (!ctx) throw new Error('useRouter must be used within RouterProvider')
  return ctx
}
