import type { MeetvoxApi } from './index'

declare global {
  interface Window {
    meetvox: MeetvoxApi
  }
}

export {}
