// Domain types shared between the Electron main process and the renderer.
// Behavior is a faithful port of recorder_blackhole.py + transcribe_meeting.py.

import type { TranscriptionEngine } from './transcription'

export interface AudioDevice {
  /** PortAudio device index, or a synthetic id for the Mac system-audio entry. */
  id: number
  name: string
  channels: number
}

/** Per-stream gain, range 0–3, default 1.0 (ported from the Python sliders). */
export interface Gains {
  mic: number
  system: number
}

/** Live per-stream VU level, 0.0–1.0 (matches Python `min(1.0, peak*gain*3)`). */
export interface Levels {
  mic: number
  system: number
}

export type RecorderPhase = 'idle' | 'recording' | 'saving' | 'error'

export interface RecorderStatus {
  phase: RecorderPhase
  /** Human-readable message mirroring the Python status line. */
  message: string
  /** Chunks written so far in the active/last session. */
  chunkCount: number
  /** Active/last session directory (absolute), or null before first record. */
  sessionDir: string | null
}

export type TranscribePhase =
  | 'idle'
  | 'needs-model'
  | 'downloading-model'
  | 'running'
  | 'done'
  | 'error'

export interface TranscribeProgress {
  phase: TranscribePhase
  message: string
  /** 1-based index of the chunk currently being processed. */
  chunkIndex: number
  chunkCount: number
}

export interface ModelDownloadProgress {
  /** Model file being downloaded (a LOCAL_MODELS `file`). */
  file: string
  receivedBytes: number
  totalBytes: number
  /** 0–1; -1 when total is unknown. */
  fraction: number
  done: boolean
  error: string | null
}

/** One transcript line. `time` is a float in seconds (json keeps the float; txt truncates to HH:MM:SS). */
export interface TranscriptEntry {
  time: number
  speaker: string
  text: string
}

export interface StartRecordingArgs {
  micId: number
  /** Mac: a real loopback-input id (BlackHole) or -1 for the ScreenCaptureKit
   *  fallback. Windows: the WASAPI render-endpoint id. */
  systemId: number
  gains: Gains
  /** Auto-save interval in seconds (default 30). */
  intervalSec: number
}

export interface StartRecordingResult {
  sessionDir: string
}

export interface StopRecordingResult {
  sessionDir: string
  chunkCount: number
}

export interface DeviceList {
  mics: AudioDevice[]
  systems: AudioDevice[]
  /** Auto-selected ids (Python auto_select_devices). null when nothing matched. */
  autoMicId: number | null
  autoSystemId: number | null
}

export interface TranscribeResult {
  meetingDir: string
  entries: TranscriptEntry[]
  txtPath: string
  jsonPath: string
}

export type Platform = 'mac' | 'win'

export interface MeetingMeta {
  name: string
  createdAt: string        // ISO
  source: 'recorded' | 'imported'
  durationSec: number
  channelMapped: boolean   // true = You/Other split; false = single-track import
}

export interface Meeting extends MeetingMeta {
  dir: string              // absolute meeting folder path
  hasTranscript: boolean
  hasSummary: boolean
}

/** Playable audio sources for a meeting: meetvox-audio:// URLs + per-source/total durations. */
export interface MeetingAudio {
  sources: string[]
  durations: number[]
  durationSec: number
}

// --- Summary providers + settings ---------------------------------------
// Shared because both the renderer Settings UI and the main summary engine use
// them; Phase 8 re-exports these from src/main/summary/types.ts.

export type ProviderKind = 'cli' | 'anthropic' | 'openai-compatible'

export interface ProviderConfig {
  id: string
  label: string
  kind: ProviderKind
  enabled: boolean
  command?: string[]
  baseUrl?: string
  model?: string | null
}

export interface SummaryConfig {
  providers: ProviderConfig[]
  defaultProviderId: string | null
}

export interface Summary {
  text: string
  provider: string
  model: string | null
  generatedAt: string
}

/** Current recordings/transcripts storage folder + whether it's the built-in default. */
export interface RecordingsDir {
  dir: string
  isDefault: boolean
}

/** Persisted app settings. Defaults live in src/main/settings.ts (from @shared/constants). */
export interface Settings {
  theme: 'light' | 'dark' | 'system'
  sidebarCollapsed: boolean
  defaultMicId: number | null
  defaultSystemId: number | null
  gains: Gains
  intervalSec: number
  preMonitorSystem: boolean
  /** Where recordings + transcripts are saved. null = the built-in default
   *  (userData/recordings). An absolute path overrides it. */
  recordingsDir: string | null
  transcription: TranscriptionSettings
  summary: SummaryConfig
}

/** Every engine keeps its own config, so switching engines never loses the others. */
export interface TranscriptionSettings {
  engine: TranscriptionEngine
  /** A LOCAL_MODELS `file`. */
  localModel: string
  serverUrl: string
  openaiModel: string
  groqModel: string
}

export interface LocalModelStatus {
  file: string
  downloaded: boolean
}

/** Result of the Settings "Test" button: a real 1-second request to the engine. */
export type EngineTestResult = { ok: true; ms: number } | { ok: false; error: string }
