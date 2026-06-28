import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'events'
import { detectProviders, type DetectDeps } from './detect'

// A spawn that, per probed binary, emits either close(0) (present) or an
// 'error' (absent — ENOENT). It keys off the FIRST argv arg or the command
// itself so the test can mark claude present and codex absent.
function probeSpawn(present: (target: string) => boolean): typeof import('child_process').spawn {
  return ((cmd: string, args: string[]) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
    }
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    // The probe target is the binary name — either cmd itself (`claude --version`)
    // or the argument to which/where (`which claude`).
    const target = args.length > 0 ? args[args.length - 1] : cmd
    setImmediate(() => {
      if (present(target)) child.emit('close', 0)
      else child.emit('error', new Error('spawn ENOENT'))
    })
    return child
  }) as unknown as typeof import('child_process').spawn
}

describe('detectProviders', () => {
  it('returns true for a present binary and false for an absent one', async () => {
    const deps: DetectDeps = { spawn: probeSpawn((t) => t === 'claude') }
    const result = await detectProviders(deps)
    expect(result).toEqual({ claude: true, codex: false })
  })

  it('returns false for a binary that exits non-zero', async () => {
    const nonZero = ((cmd: string, args: string[]) => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
      }
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      const target = args.length > 0 ? args[args.length - 1] : cmd
      setImmediate(() => child.emit('close', target === 'claude' ? 0 : 1))
      return child
    }) as unknown as typeof import('child_process').spawn

    const result = await detectProviders({ spawn: nonZero })
    expect(result).toEqual({ claude: true, codex: false })
  })

  it('returns both false when neither is on PATH', async () => {
    const result = await detectProviders({ spawn: probeSpawn(() => false) })
    expect(result).toEqual({ claude: false, codex: false })
  })
})
