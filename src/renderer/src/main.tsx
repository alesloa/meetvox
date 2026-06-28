import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ThemeProvider } from './app/theme'
import { RouterProvider } from './app/router'
import { MeetingsProvider } from './app/meetings'
import { SettingsProvider } from './app/settings'
import './index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <RouterProvider>
        <MeetingsProvider>
          <SettingsProvider>
            <App />
          </SettingsProvider>
        </MeetingsProvider>
      </RouterProvider>
    </ThemeProvider>
  </React.StrictMode>
)
