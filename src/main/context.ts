// Main-process app context: platform, paths, binary resolution, and the single
// shared Recorder. Built once at startup and passed to the IPC layer.

import { app } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { Recorder } from './audio/recorder'
import { Monitor } from './monitor'
import { resolveBinary, type BinaryName } from './binaries/resolve'
import { loadSettings } from './settings'
import type { Platform, Settings } from '@shared/types'

export interface AppContext {
  platform: Platform
  /** Electron userData dir — holds settings.json (settings + encrypted secrets). */
  userDataDir: string
  /** Live root for recordings + transcripts. Resolved from settings.recordingsDir
   *  at startup; reassigned when the user picks a folder (chooseRecordingsDir). */
  recordingsRoot: string
  /** The built-in default root (userData/recordings) — used to detect/reset to default. */
  defaultRecordingsRoot: string
  homeDir: string
  recorder: Recorder
  /** Pre-record live VU monitor (mic-only by default). Never active with the recorder. */
  monitor: Monitor
  /** Absolute path to a bundled binary (throws with guidance if missing). */
  binary: (name: BinaryName) => string
  /** Settings snapshot loaded at startup; refreshed by the saveSettings IPC handler. */
  settings: Settings
}

export function createContext(): AppContext {
  const platform: Platform = process.platform === 'win32' ? 'win' : 'mac'
  const userDataDir = app.getPath('userData')
  const settings = loadSettings(userDataDir)
  const defaultRecordingsRoot = join(userDataDir, 'recordings')
  // A saved custom folder overrides the default; null falls back to it.
  const recordingsRoot = settings.recordingsDir ?? defaultRecordingsRoot
  // Dev base = repo root (two levels up from out/main); packaged uses resourcesPath.
  const projectRoot = app.getAppPath()

  const binary = (name: BinaryName): string =>
    resolveBinary(name, {
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      projectRoot
    })

  return {
    platform,
    userDataDir,
    recordingsRoot,
    defaultRecordingsRoot,
    homeDir: homedir(),
    recorder: new Recorder(),
    monitor: new Monitor(),
    binary,
    settings
  }
}
