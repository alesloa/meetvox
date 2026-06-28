// Resolve bundled native binary paths, handling dev vs packaged builds.
//
// Layout (one folder per platform/arch), bundled via electron-builder extraResources:
//   resources/mac-arm64/{whisper-cli,ffmpeg,meetvox-syscap}
//   resources/mac-x64/{whisper-cli,ffmpeg,meetvox-syscap}
//   resources/win-x64/{whisper-cli.exe,ffmpeg.exe}
//
// Dev:      <projectRoot>/resources/<platform-dir>/<file>
// Packaged: <process.resourcesPath>/<platform-dir>/<file>
//
// The pure helpers (platformDir/binaryFileName/binaryRelPath) carry the mapping
// logic and are unit-tested; resolveBinary wires in the Electron base path.

import { join } from 'path'
import { existsSync } from 'fs'

export type BinaryName = 'whisper-cli' | 'ffmpeg' | 'meetvox-syscap'

export function platformDir(platform: NodeJS.Platform, arch: string): string {
  if (platform === 'darwin') {
    if (arch === 'arm64') return 'mac-arm64'
    if (arch === 'x64') return 'mac-x64'
  }
  if (platform === 'win32' && arch === 'x64') return 'win-x64'
  throw new Error(`Unsupported platform/arch: ${platform}/${arch}`)
}

export function binaryFileName(name: BinaryName, platform: NodeJS.Platform): string {
  // The Swift syscap helper is mac-only and never gets a .exe suffix.
  const needsExe = platform === 'win32' && name !== 'meetvox-syscap'
  return needsExe ? `${name}.exe` : name
}

export function binaryRelPath(name: BinaryName, platform: NodeJS.Platform, arch: string): string {
  return `${platformDir(platform, arch)}/${binaryFileName(name, platform)}`
}

/** Base directory that holds the per-platform resource folders. */
export function resourcesRoot(opts: {
  isPackaged: boolean
  resourcesPath: string
  projectRoot: string
}): string {
  return opts.isPackaged ? opts.resourcesPath : join(opts.projectRoot, 'resources')
}

export interface ResolveContext {
  isPackaged: boolean
  resourcesPath: string
  projectRoot: string
  platform?: NodeJS.Platform
  arch?: string
}

/** Absolute path to a bundled binary. Throws a clear error if it is missing. */
export function resolveBinary(name: BinaryName, ctx: ResolveContext): string {
  const platform = ctx.platform ?? process.platform
  const arch = ctx.arch ?? process.arch
  const root = resourcesRoot(ctx)
  const full = join(root, binaryRelPath(name, platform, arch))
  if (!existsSync(full)) {
    throw new Error(
      `Bundled binary "${name}" not found at ${full}. ` +
        `Place the ${platformDir(platform, arch)} build under resources/ (see resources/README.md).`
    )
  }
  return full
}
