import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { platformDir, binaryFileName, binaryRelPath, resolveBinary } from './resolve'

describe('resolveBinary — a missing binary says how to fix it', () => {
  const empty = (): string => mkdtempSync(join(tmpdir(), 'meetvox-resolve-'))

  it('installed app: tells the user to reinstall', () => {
    const dir = empty()
    try {
      expect(() =>
        resolveBinary('ffmpeg', {
          isPackaged: true,
          resourcesPath: dir,
          projectRoot: dir,
          platform: 'darwin',
          arch: 'arm64'
        })
      ).toThrow('Meetvox is missing ffmpeg, a file it needs. Reinstall Meetvox.')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('source checkout: names the npm script that builds or fetches it', () => {
    const dir = empty()
    try {
      const run = (platform: NodeJS.Platform, arch: string): (() => string) => () =>
        resolveBinary('whisper-cli', { isPackaged: false, resourcesPath: dir, projectRoot: dir, platform, arch })
      expect(run('darwin', 'arm64')).toThrow('npm run binaries:mac')
      expect(run('win32', 'x64')).toThrow('npm run binaries:win')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('platformDir — maps platform/arch to the bundled resource folder', () => {
  it('maps mac arm64 / x64 and win x64', () => {
    expect(platformDir('darwin', 'arm64')).toBe('mac-arm64')
    expect(platformDir('darwin', 'x64')).toBe('mac-x64')
    expect(platformDir('win32', 'x64')).toBe('win-x64')
  })
  it('throws on unsupported combos', () => {
    expect(() => platformDir('linux', 'x64')).toThrow()
  })
})

describe('binaryFileName — adds .exe only on Windows, never for the mac-only helper', () => {
  it('adds .exe for whisper-cli/ffmpeg on win32', () => {
    expect(binaryFileName('whisper-cli', 'win32')).toBe('whisper-cli.exe')
    expect(binaryFileName('ffmpeg', 'win32')).toBe('ffmpeg.exe')
  })
  it('no extension on darwin', () => {
    expect(binaryFileName('whisper-cli', 'darwin')).toBe('whisper-cli')
    expect(binaryFileName('meetvox-syscap', 'darwin')).toBe('meetvox-syscap')
  })
})

describe('binaryRelPath — <platform-dir>/<filename>', () => {
  it('joins platform dir and filename', () => {
    expect(binaryRelPath('ffmpeg', 'darwin', 'arm64')).toBe('mac-arm64/ffmpeg')
    expect(binaryRelPath('whisper-cli', 'win32', 'x64')).toBe('win-x64/whisper-cli.exe')
  })
})
