// Preload bridge: exposes a typed, minimal `window.meetvox` API over the IPC
// contract in src/shared/ipc.ts. The renderer never touches ipcRenderer directly.

import { contextBridge, ipcRenderer } from 'electron'
import { Commands, Events, type TrayAction, type TrayView } from '@shared/ipc'
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
} from '@shared/types'

function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  listDevices: (): Promise<DeviceList> => ipcRenderer.invoke(Commands.listDevices),
  startRecording: (args: StartRecordingArgs): Promise<StartRecordingResult> =>
    ipcRenderer.invoke(Commands.startRecording, args),
  stopRecording: (): Promise<StopRecordingResult> => ipcRenderer.invoke(Commands.stopRecording),
  startMonitor: (args: {
    micId: number
    gains: Gains
    includeSystem: boolean
    systemId?: number | null
  }): Promise<void> => ipcRenderer.invoke(Commands.startMonitor, args),
  stopMonitor: (): Promise<void> => ipcRenderer.invoke(Commands.stopMonitor),
  setGain: (gains: Gains): Promise<void> => ipcRenderer.invoke(Commands.setGain, gains),
  transcribe: (meetingDir?: string): Promise<TranscribeResult> =>
    ipcRenderer.invoke(Commands.transcribe, { meetingDir }),
  importAudio: (kind: 'file' | 'folder'): Promise<{ meetingDir: string }> =>
    ipcRenderer.invoke(Commands.importAudio, { kind }),
  openMeetingFolder: (meetingDir?: string): Promise<void> =>
    ipcRenderer.invoke(Commands.openMeetingFolder, { meetingDir }),
  getRecordingsDir: (): Promise<RecordingsDir> => ipcRenderer.invoke(Commands.getRecordingsDir),
  chooseRecordingsDir: (): Promise<RecordingsDir | null> =>
    ipcRenderer.invoke(Commands.chooseRecordingsDir),
  resetRecordingsDir: (): Promise<RecordingsDir> =>
    ipcRenderer.invoke(Commands.resetRecordingsDir),
  openRecordingsDir: (): Promise<void> => ipcRenderer.invoke(Commands.openRecordingsDir),
  retryModelDownload: (): Promise<void> => ipcRenderer.invoke(Commands.retryModelDownload),
  getPlatform: (): Promise<'mac' | 'win'> => ipcRenderer.invoke(Commands.getPlatform),
  hasRecordings: (): Promise<boolean> => ipcRenderer.invoke(Commands.hasRecordings),
  listMeetings: (): Promise<Meeting[]> => ipcRenderer.invoke(Commands.listMeetings),
  getMeeting: (dir: string): Promise<{ meeting: Meeting; entries: TranscriptEntry[] }> =>
    ipcRenderer.invoke(Commands.getMeeting, { dir }),
  renameMeeting: (dir: string, name: string): Promise<void> =>
    ipcRenderer.invoke(Commands.renameMeeting, { dir, name }),
  deleteMeeting: (dir: string): Promise<void> => ipcRenderer.invoke(Commands.deleteMeeting, { dir }),
  exportTranscript: (dir: string, format: 'md' | 'txt' | 'srt'): Promise<{ path: string }> =>
    ipcRenderer.invoke(Commands.exportTranscript, { dir, format }),
  getMeetingAudio: (dir: string): Promise<MeetingAudio> =>
    ipcRenderer.invoke(Commands.getMeetingAudio, { dir }),
  getSettings: (): Promise<{ settings: Settings; secretsSet: Record<string, boolean> }> =>
    ipcRenderer.invoke(Commands.getSettings),
  saveSettings: (partial: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke(Commands.saveSettings, partial),
  setProviderKey: (id: string, key: string): Promise<void> =>
    ipcRenderer.invoke(Commands.setProviderKey, { id, key }),
  clearProviderKey: (id: string): Promise<void> =>
    ipcRenderer.invoke(Commands.clearProviderKey, { id }),
  generateSummary: (dir: string): Promise<Summary> =>
    ipcRenderer.invoke(Commands.generateSummary, { dir }),
  getSummary: (dir: string): Promise<Summary | null> =>
    ipcRenderer.invoke(Commands.getSummary, { dir }),
  detectProviders: (): Promise<{ claude: boolean; codex: boolean }> =>
    ipcRenderer.invoke(Commands.detectProviders),
  getProviderPresets: (): Promise<ProviderConfig[]> =>
    ipcRenderer.invoke(Commands.getProviderPresets),
  getAppVersion: (): Promise<string> => ipcRenderer.invoke(Commands.getAppVersion),
  getNotes: (args: { dir: string }): Promise<string> => ipcRenderer.invoke(Commands.getNotes, args),
  saveNotes: (args: { dir: string; text: string }): Promise<void> =>
    ipcRenderer.invoke(Commands.saveNotes, args),

  onLevels: (cb: (l: Levels) => void) => on<Levels>(Events.levels, cb),
  onRecorderStatus: (cb: (s: RecorderStatus) => void) => on<RecorderStatus>(Events.recorderStatus, cb),
  onTranscribeProgress: (cb: (p: TranscribeProgress) => void) =>
    on<TranscribeProgress>(Events.transcribeProgress, cb),
  onModelDownloadProgress: (cb: (p: ModelDownloadProgress) => void) =>
    on<ModelDownloadProgress>(Events.modelDownloadProgress, cb),
  onTrayNavigate: (cb: (view: TrayView) => void) => on<TrayView>(Events.trayNavigate, cb),
  onTrayAction: (cb: (action: TrayAction) => void) => on<TrayAction>(Events.trayAction, cb)
}

export type MeetvoxApi = typeof api

contextBridge.exposeInMainWorld('meetvox', api)
