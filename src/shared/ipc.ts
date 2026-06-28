// Typed IPC channel registry. One source of truth for channel names + payload
// shapes, imported by main (handlers), preload (bridge), and renderer (client).

import type {
  DeviceList,
  Gains,
  Levels,
  Meeting,
  MeetingAudio,
  ModelDownloadProgress,
  ProviderConfig,
  RecorderStatus,
  RecordingsDir,
  Settings,
  StartRecordingArgs,
  StartRecordingResult,
  StopRecordingResult,
  Summary,
  TranscribeProgress,
  TranscribeResult,
  TranscriptEntry
} from './types'

/** Renderer → main, request/response (ipcRenderer.invoke). */
export const Commands = {
  listDevices: 'cmd:listDevices',
  startRecording: 'cmd:startRecording',
  stopRecording: 'cmd:stopRecording',
  startMonitor: 'cmd:startMonitor',
  stopMonitor: 'cmd:stopMonitor',
  setGain: 'cmd:setGain',
  transcribe: 'cmd:transcribe',
  importAudio: 'cmd:importAudio',
  openMeetingFolder: 'cmd:openMeetingFolder',
  getRecordingsDir: 'cmd:getRecordingsDir',
  chooseRecordingsDir: 'cmd:chooseRecordingsDir',
  resetRecordingsDir: 'cmd:resetRecordingsDir',
  openRecordingsDir: 'cmd:openRecordingsDir',
  retryModelDownload: 'cmd:retryModelDownload',
  getPlatform: 'cmd:getPlatform',
  hasRecordings: 'cmd:hasRecordings',
  listMeetings: 'cmd:listMeetings',
  getMeeting: 'cmd:getMeeting',
  renameMeeting: 'cmd:renameMeeting',
  deleteMeeting: 'cmd:deleteMeeting',
  exportTranscript: 'cmd:exportTranscript',
  getMeetingAudio: 'cmd:getMeetingAudio',
  getSettings: 'cmd:getSettings',
  saveSettings: 'cmd:saveSettings',
  setProviderKey: 'cmd:setProviderKey',
  clearProviderKey: 'cmd:clearProviderKey',
  generateSummary: 'cmd:generateSummary',
  getSummary: 'cmd:getSummary',
  detectProviders: 'cmd:detectProviders',
  getProviderPresets: 'cmd:getProviderPresets',
  getAppVersion: 'cmd:getAppVersion',
  getNotes: 'cmd:getNotes',
  saveNotes: 'cmd:saveNotes'
} as const

/** Main → renderer, fire-and-forget (webContents.send). */
export const Events = {
  levels: 'evt:levels',
  recorderStatus: 'evt:recorderStatus',
  transcribeProgress: 'evt:transcribeProgress',
  modelDownloadProgress: 'evt:modelDownloadProgress',
  // Tray (menu-bar) → renderer. trayNavigate routes the renderer to a view;
  // trayAction drives the existing record start/stop handlers from the tray menu.
  trayNavigate: 'evt:trayNavigate',
  trayAction: 'evt:trayAction'
} as const

/** Views the tray AND the application menu can navigate the renderer to
 * (subset of NavAction `type`s — the menu's File items reuse this channel). */
export type TrayView = 'home' | 'library' | 'import' | 'settings'

/** Record controls the tray can trigger in the renderer's HomeView. */
export type TrayAction = 'start' | 'stop'

export interface CommandMap {
  [Commands.listDevices]: { args: void; result: DeviceList }
  [Commands.startRecording]: { args: StartRecordingArgs; result: StartRecordingResult }
  [Commands.stopRecording]: { args: void; result: StopRecordingResult }
  [Commands.startMonitor]: {
    args: { micId: number; gains: Gains; includeSystem: boolean; systemId?: number | null }
    result: void
  }
  [Commands.stopMonitor]: { args: void; result: void }
  [Commands.setGain]: { args: Gains; result: void }
  [Commands.transcribe]: { args: { meetingDir?: string }; result: TranscribeResult }
  [Commands.importAudio]: { args: { kind: 'file' | 'folder' }; result: { meetingDir: string } }
  [Commands.openMeetingFolder]: { args: { meetingDir?: string }; result: void }
  // Recordings + transcripts storage folder. `isDefault` = using userData/recordings.
  [Commands.getRecordingsDir]: { args: void; result: RecordingsDir }
  // Opens a native folder picker; persists + switches live. null = user canceled.
  [Commands.chooseRecordingsDir]: { args: void; result: RecordingsDir | null }
  [Commands.resetRecordingsDir]: { args: void; result: RecordingsDir }
  [Commands.openRecordingsDir]: { args: void; result: void }
  [Commands.retryModelDownload]: { args: void; result: void }
  [Commands.getPlatform]: { args: void; result: 'mac' | 'win' }
  [Commands.hasRecordings]: { args: void; result: boolean }
  [Commands.listMeetings]: { args: void; result: Meeting[] }
  [Commands.getMeeting]: { args: { dir: string }; result: { meeting: Meeting; entries: TranscriptEntry[] } }
  [Commands.renameMeeting]: { args: { dir: string; name: string }; result: void }
  [Commands.deleteMeeting]: { args: { dir: string }; result: void }
  [Commands.exportTranscript]: { args: { dir: string; format: 'md' | 'txt' | 'srt' }; result: { path: string } }
  [Commands.getMeetingAudio]: { args: { dir: string }; result: MeetingAudio }
  // Returns NO raw secrets — only a per-provider "is set" boolean map.
  [Commands.getSettings]: { args: void; result: { settings: Settings; secretsSet: Record<string, boolean> } }
  [Commands.saveSettings]: { args: Partial<Settings>; result: Settings }
  [Commands.setProviderKey]: { args: { id: string; key: string }; result: void }
  [Commands.clearProviderKey]: { args: { id: string }; result: void }
  // Summary engine. generateSummary sends transcript text OFF the machine when a
  // network/cloud-CLI provider is configured — errors (no provider, no key, CLI
  // not logged in, API non-200) propagate as a rejected invoke for the UI to show.
  [Commands.generateSummary]: { args: { dir: string }; result: Summary }
  [Commands.getSummary]: { args: { dir: string }; result: Summary | null }
  [Commands.detectProviders]: { args: void; result: { claude: boolean; codex: boolean } }
  [Commands.getProviderPresets]: { args: void; result: ProviderConfig[] }
  [Commands.getAppVersion]: { args: void; result: string }
  [Commands.getNotes]: { args: { dir: string }; result: string }
  [Commands.saveNotes]: { args: { dir: string; text: string }; result: void }
}

export interface EventMap {
  [Events.levels]: Levels
  [Events.recorderStatus]: RecorderStatus
  [Events.transcribeProgress]: TranscribeProgress
  [Events.modelDownloadProgress]: ModelDownloadProgress
  [Events.trayNavigate]: TrayView
  [Events.trayAction]: TrayAction
}

export type CommandChannel = keyof CommandMap
export type EventChannel = keyof EventMap
