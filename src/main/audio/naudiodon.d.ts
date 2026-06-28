// Minimal ambient types for the untyped `naudiodon2` native addon — only the
// surface this app uses (PortAudio device enumeration + an input AudioIO stream).
declare module 'naudiodon2' {
  export const SampleFormatFloat32: number
  export const SampleFormat16Bit: number

  export interface PaDeviceInfo {
    id: number
    name: string
    maxInputChannels: number
    maxOutputChannels: number
    defaultSampleRate: number
    hostAPIName: string
  }

  export function getDevices(): PaDeviceInfo[]
  export function getHostAPIs(): unknown

  export interface AudioIOOptions {
    inOptions: {
      channelCount: number
      sampleFormat: number
      sampleRate: number
      deviceId: number
      closeOnError?: boolean
    }
  }

  export class AudioIO {
    constructor(options: AudioIOOptions)
    on(event: 'data', cb: (chunk: Buffer) => void): void
    on(event: 'error', cb: (err: Error) => void): void
    start(): void
    quit(cb?: () => void): void
    abort(cb?: () => void): void
  }
}
