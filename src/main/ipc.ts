// IPC layer: wires renderer commands to the audio/transcription modules and pushes
// recorder levels/status, transcription progress, and model-download progress back
// to the renderer. One handler per channel in the typed Commands registry.

import { app, ipcMain, shell, dialog, safeStorage, BrowserWindow } from 'electron'
import { spawn } from 'child_process'
import { writeFileSync } from 'fs'
import { join, basename } from 'path'
import { existsSync, readdirSync, statSync, mkdirSync } from 'fs'
import { Commands, Events } from '@shared/ipc'
import type {
  StartRecordingArgs,
  StartRecordingResult,
  StopRecordingResult,
  Gains,
  TranscribeResult,
  TranscribeProgress,
  DeviceList,
  Settings
} from '@shared/types'
import type { AppContext } from './context'
import { safeSend } from './safeSend'
import { loadSettings, saveSettings, setSecret, clearSecret, secretIds } from './settings'
import { enumerateDevices } from './audio/enumerate'
import { listMeetings, getMeeting, renameMeeting, deleteMeeting } from './library'
import { getMeetingAudio } from './protocol'
import { toMarkdown, toPlainText, toSrt } from './export'
import { createSystemSource, type SystemSource } from './audio/systemSource'
import { ensureModel } from './models/download'
import { makeRunners, runPipeline } from './transcribe/pipeline'
import { transcribe as whisperTranscribe } from './transcribe/whisper'
import { importFolder, importFile, transcribeSingleTrack } from './import'
import { generateSummary, getSummary } from './summary'
import { getNotes, saveNotes } from './notes'
import { detectProviders } from './summary/detect'
import { PRESETS } from './summary/providers'

/** Newest recordings/meeting_* directory, or null. */
function newestMeeting(recordingsRoot: string): string | null {
  if (!existsSync(recordingsRoot)) return null
  const dirs = readdirSync(recordingsRoot)
    .filter((n) => n.startsWith('meeting_'))
    .map((n) => join(recordingsRoot, n))
    .filter((p) => statSync(p).isDirectory())
    .sort()
  return dirs.length ? dirs[dirs.length - 1] : null
}

export function registerIpc(ctx: AppContext, getWindow: () => BrowserWindow | null): void {
  const send = (channel: string, payload: unknown): void => safeSend(getWindow(), channel, payload)

  // Forward recorder events to the renderer.
  ctx.recorder.on('levels', (l) => send(Events.levels, l))
  ctx.recorder.on('status', (s) => send(Events.recorderStatus, s))

  // Forward monitor events. Levels reuse the recorder's channel (never active
  // simultaneously). A monitor error surfaces on the same status channel using
  // the existing RecorderStatus shape — no new event channel needed.
  ctx.monitor.on('levels', (l) => send(Events.levels, l))
  ctx.monitor.on('error', (e: Error) =>
    send(Events.recorderStatus, {
      phase: 'error',
      message: `Mic monitor error: ${e.message}`,
      chunkCount: 0,
      sessionDir: null
    })
  )

  ipcMain.handle(Commands.getPlatform, () => ctx.platform)

  ipcMain.handle(
    Commands.hasRecordings,
    () => ctx.recorder.getSessionDir() !== null || newestMeeting(ctx.recordingsRoot) !== null
  )

  ipcMain.handle(Commands.listDevices, (): Promise<DeviceList> => enumerateDevices(ctx.platform))

  ipcMain.handle(
    Commands.startRecording,
    async (_e, args: StartRecordingArgs): Promise<StartRecordingResult> => {
      // Handoff: the mic can only be opened once. Release the pre-record monitor
      // before the recorder claims the same device (belt-and-suspenders — the
      // renderer also stops it first).
      if (ctx.monitor.isMonitoring()) await ctx.monitor.stop()

      const systemSource =
        ctx.platform === 'mac'
          ? createSystemSource('mac', {
              syscapPath: ctx.binary('meetvox-syscap'),
              deviceId: args.systemId // real loopback id → BlackHole input; -1 → ScreenCaptureKit
            })
          : createSystemSource('win', { deviceId: args.systemId })

      const sessionDir = await ctx.recorder.start({
        micId: args.micId,
        systemSource,
        gains: args.gains,
        intervalSec: args.intervalSec,
        recordingsRoot: ctx.recordingsRoot
      })
      return { sessionDir }
    }
  )

  ipcMain.handle(Commands.stopRecording, (): Promise<StopRecordingResult> => ctx.recorder.stop())

  ipcMain.handle(
    Commands.startMonitor,
    async (
      _e,
      {
        micId,
        gains,
        includeSystem,
        systemId
      }: { micId: number; gains: Gains; includeSystem: boolean; systemId?: number | null }
    ) => {
      // Pre-record system metering. On macOS, meter whichever system device is
      // selected — a BlackHole loopback (PortAudio input) OR the built-in Core Audio
      // tap (synthetic id). Neither blocks: the tap uses the audio-recording
      // permission (granted once), not screen recording. This is what makes the
      // System VU move before recording. (Windows stays behind includeSystem.)
      let systemSource: SystemSource | undefined
      if (ctx.platform === 'mac' && systemId != null) {
        systemSource = createSystemSource('mac', {
          syscapPath: ctx.binary('meetvox-syscap'),
          deviceId: systemId
        })
      } else if (includeSystem && ctx.platform === 'mac') {
        systemSource = createSystemSource('mac', { syscapPath: ctx.binary('meetvox-syscap') })
      } else if (ctx.platform === 'win' && systemId != null) {
        // Windows: meter the chosen system input live — a VB-Cable / VoiceMeeter input,
        // or a WASAPI render endpoint where loopback is supported. Opening a render
        // endpoint that can't loopback errors out and the meter stays flat (fail-soft via
        // the renderer's catch), which is itself the diagnostic for that path.
        systemSource = createSystemSource('win', { deviceId: systemId })
      }
      await ctx.monitor.start({ micId, gains, systemSource })
    }
  )

  ipcMain.handle(Commands.stopMonitor, () => ctx.monitor.stop())

  ipcMain.handle(Commands.setGain, (_e, gains: Gains) => {
    // Route to both — only the active stream uses it now; the idle one just
    // stores it for when it next opens.
    ctx.recorder.setGain(gains)
    ctx.monitor.setGain(gains)
  })

  ipcMain.handle(
    Commands.transcribe,
    async (_e, { meetingDir }: { meetingDir?: string }): Promise<TranscribeResult> => {
      const dir = meetingDir ?? ctx.recorder.getSessionDir() ?? newestMeeting(ctx.recordingsRoot)
      if (!dir) throw new Error('No recording to transcribe yet.')

      send(Events.transcribeProgress, {
        phase: 'needs-model',
        message: 'Checking transcription model…',
        chunkIndex: 0,
        chunkCount: 0
      })

      const modelPath = await ensureModel({
        homeDir: ctx.homeDir,
        onProgress: (p) => send(Events.modelDownloadProgress, p)
      })

      const runners = makeRunners({
        ffmpegPath: ctx.binary('ffmpeg'),
        whisperPath: ctx.binary('whisper-cli'),
        modelPath
      })

      return runPipeline(dir, runners, {
        onProgress: (p) => send(Events.transcribeProgress, p)
      })
    }
  )

  ipcMain.handle(
    Commands.importAudio,
    async (_e, { kind }: { kind: 'file' | 'folder' }): Promise<{ meetingDir: string }> => {
      // Pick the source (read-only). Cancel → no-op, empty meetingDir (no throw).
      const pick = await dialog.showOpenDialog(
        kind === 'file'
          ? {
              properties: ['openFile'],
              filters: [
                {
                  name: 'Audio',
                  extensions: [
                    'wav',
                    'mp3',
                    'mp4',
                    'm4a',
                    'flac',
                    'ogg',
                    'mkv',
                    'webm',
                    'wma',
                    'aiff'
                  ]
                }
              ]
            }
          : { properties: ['openDirectory'] }
      )
      if (pick.canceled || pick.filePaths.length === 0) return { meetingDir: '' }
      const picked = pick.filePaths[0]

      const onProgress = (p: TranscribeProgress): void => send(Events.transcribeProgress, p)

      send(Events.transcribeProgress, {
        phase: 'needs-model',
        message: 'Checking transcription model…',
        chunkIndex: 0,
        chunkCount: 0
      })
      const modelPath = await ensureModel({
        homeDir: ctx.homeDir,
        onProgress: (p) => send(Events.modelDownloadProgress, p)
      })

      // Remove a half-created meeting folder if transcription fails after import,
      // so a failed import never leaves an orphan in the library. Uses the
      // path-guarded delete (inside recordingsRoot + meeting_* basename).
      const cleanupOnFailure = async (dir: string, run: () => Promise<void>): Promise<void> => {
        try {
          await run()
        } catch (e) {
          await deleteMeeting(dir, ctx.recordingsRoot).catch(() => {})
          throw e
        }
      }

      if (kind === 'folder') {
        // Stereo chunks → standard You/Other pipeline.
        const { meetingDir } = importFolder(picked, ctx.recordingsRoot, new Date())
        await cleanupOnFailure(meetingDir, async () => {
          const runners = makeRunners({
            ffmpegPath: ctx.binary('ffmpeg'),
            whisperPath: ctx.binary('whisper-cli'),
            modelPath
          })
          await runPipeline(meetingDir, runners, { onProgress })
        })
        return { meetingDir }
      }

      // Single file → decode to one wav, transcribe as a single neutral "Speaker".
      const { meetingDir } = await importFile(picked, ctx.recordingsRoot, new Date(), {
        spawn,
        ffmpegPath: ctx.binary('ffmpeg')
      })
      await cleanupOnFailure(meetingDir, async () => {
        onProgress({
          phase: 'running',
          message: 'Transcribing imported audio…',
          chunkIndex: 1,
          chunkCount: 1
        })
        await transcribeSingleTrack(meetingDir, join(meetingDir, 'audio.wav'), {
          transcribe: (wav) =>
            whisperTranscribe({
              whisperPath: ctx.binary('whisper-cli'),
              modelPath,
              wavPath: wav
            }),
          now: () => new Date()
        })
      })
      onProgress({
        phase: 'done',
        message: 'Imported audio transcribed',
        chunkIndex: 0,
        chunkCount: 0
      })
      return { meetingDir }
    }
  )

  ipcMain.handle(Commands.openMeetingFolder, async (_e, { meetingDir }: { meetingDir?: string }) => {
    const dir =
      meetingDir ??
      ctx.recorder.getSessionDir() ??
      newestMeeting(ctx.recordingsRoot) ??
      ctx.recordingsRoot
    if (existsSync(dir)) await shell.openPath(dir)
  })

  // --- Recordings folder (where recordings + transcripts are saved) ---------
  const recordingsDirInfo = (): { dir: string; isDefault: boolean } => ({
    dir: ctx.recordingsRoot,
    isDefault: ctx.recordingsRoot === ctx.defaultRecordingsRoot
  })

  ipcMain.handle(Commands.getRecordingsDir, () => recordingsDirInfo())

  ipcMain.handle(Commands.chooseRecordingsDir, async () => {
    const pick = await dialog.showOpenDialog({
      title: 'Choose where Meetvox saves recordings & transcripts',
      defaultPath: ctx.recordingsRoot,
      properties: ['openDirectory', 'createDirectory']
    })
    if (pick.canceled || pick.filePaths.length === 0) return null
    const dir = pick.filePaths[0]
    mkdirSync(dir, { recursive: true })
    // Switch live: every consumer reads ctx.recordingsRoot at call time (the recorder
    // is handed it per start, the audio protocol guard reads it via a getter), so new
    // recordings land here immediately. Existing meetings stay at the old path.
    ctx.recordingsRoot = dir
    ctx.settings = saveSettings(ctx.userDataDir, { recordingsDir: dir })
    return recordingsDirInfo()
  })

  ipcMain.handle(Commands.resetRecordingsDir, () => {
    mkdirSync(ctx.defaultRecordingsRoot, { recursive: true })
    ctx.recordingsRoot = ctx.defaultRecordingsRoot
    ctx.settings = saveSettings(ctx.userDataDir, { recordingsDir: null })
    return recordingsDirInfo()
  })

  ipcMain.handle(Commands.openRecordingsDir, async () => {
    if (!existsSync(ctx.recordingsRoot)) mkdirSync(ctx.recordingsRoot, { recursive: true })
    await shell.openPath(ctx.recordingsRoot)
  })

  ipcMain.handle(Commands.retryModelDownload, async () => {
    await ensureModel({
      homeDir: ctx.homeDir,
      onProgress: (p) => send(Events.modelDownloadProgress, p)
    })
  })

  ipcMain.handle(Commands.listMeetings, () => listMeetings(ctx.recordingsRoot))

  ipcMain.handle(Commands.getMeeting, (_e, { dir }: { dir: string }) => getMeeting(dir))

  ipcMain.handle(Commands.getMeetingAudio, (_e, { dir }: { dir: string }) => getMeetingAudio(dir))

  ipcMain.handle(
    Commands.renameMeeting,
    (_e, { dir, name }: { dir: string; name: string }) => renameMeeting(dir, name)
  )

  ipcMain.handle(Commands.deleteMeeting, (_e, { dir }: { dir: string }) =>
    deleteMeeting(dir, ctx.recordingsRoot)
  )

  ipcMain.handle(
    Commands.exportTranscript,
    async (_e, { dir, format }: { dir: string; format: 'md' | 'txt' | 'srt' }) => {
      const { meeting, entries } = await getMeeting(dir)

      let content: string
      let ext: string
      if (format === 'md') {
        content = toMarkdown(entries, meeting.name)
        ext = 'md'
      } else if (format === 'srt') {
        content = toSrt(entries)
        ext = 'srt'
      } else {
        content = toPlainText(entries)
        ext = 'txt'
      }

      const defaultName = `${basename(dir)}.${ext}`
      const { filePath, canceled } = await dialog.showSaveDialog({
        defaultPath: join(ctx.recordingsRoot, defaultName),
        filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
      })

      if (canceled || !filePath) return { path: '' }

      writeFileSync(filePath, content, 'utf8')
      return { path: filePath }
    }
  )

  // --- Settings + provider-key vault ---
  // getSettings returns the persisted settings plus a per-provider "is set"
  // boolean map. It NEVER returns raw secrets.
  ipcMain.handle(
    Commands.getSettings,
    (): { settings: Settings; secretsSet: Record<string, boolean> } => {
      const settings = loadSettings(ctx.userDataDir)
      const secretsSet: Record<string, boolean> = {}
      for (const id of secretIds(ctx.userDataDir)) secretsSet[id] = true
      return { settings, secretsSet }
    }
  )

  ipcMain.handle(Commands.saveSettings, (_e, partial: Partial<Settings>): Settings => {
    const merged = saveSettings(ctx.userDataDir, partial)
    // Keep the in-memory snapshot fresh so other handlers see updated values.
    ctx.settings = merged
    return merged
  })

  // setProviderKey throws (via setSecret) when OS encryption is unavailable;
  // the rejection surfaces to the renderer, which the Settings UI handles.
  ipcMain.handle(Commands.setProviderKey, (_e, { id, key }: { id: string; key: string }) => {
    setSecret(ctx.userDataDir, id, key, safeStorage)
  })

  ipcMain.handle(Commands.clearProviderKey, (_e, { id }: { id: string }) => {
    clearSecret(ctx.userDataDir, id)
  })

  // --- AI summary engine ---
  // PRIVACY: generateSummary sends transcript text OFF the machine when an API or
  // cloud-CLI provider is configured — the only break from Meetvox's local-only
  // posture. The renderer shows a privacy note before a network provider is
  // enabled (Phase 8 UI). Errors (no provider enabled, missing API key, CLI not
  // logged in, API non-200) propagate to the renderer as a rejected invoke; the
  // UI surfaces the message. The provider key (safeStorage vault) is used only in
  // the request header inside complete(), never logged or placed in a URL.
  ipcMain.handle(
    Commands.generateSummary,
    (_e, { dir }: { dir: string }) =>
      generateSummary({
        meetingDir: dir,
        userDataDir: ctx.userDataDir,
        storage: safeStorage,
        spawn,
        fetch,
        now: () => new Date()
      })
  )

  ipcMain.handle(Commands.getSummary, (_e, { dir }: { dir: string }) => getSummary(dir))

  ipcMain.handle(Commands.detectProviders, () => detectProviders({ spawn }))

  ipcMain.handle(Commands.getProviderPresets, () => PRESETS)

  ipcMain.handle(Commands.getAppVersion, (): string => app.getVersion())

  ipcMain.handle(Commands.getNotes, (_e, { dir }: { dir: string }): string => getNotes(dir))

  ipcMain.handle(Commands.saveNotes, (_e, { dir, text }: { dir: string; text: string }): void => {
    saveNotes(dir, text)
  })
}
