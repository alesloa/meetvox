// CLI provider detection: probe whether `claude` and `codex` are on $PATH so the
// Settings UI can show which CLI providers are usable without a key.
//
// We probe via the platform's path-lookup command (`which` on mac, `where` on
// win) and treat a non-zero exit OR a spawn error (ENOENT) as "absent". spawn is
// injected so tests can simulate present/absent without touching the real PATH.

export interface DetectDeps {
  spawn: typeof import('child_process').spawn
}

/** Resolve to true if `binary` is found on $PATH, false otherwise. Never rejects. */
function probe(binary: string, deps: DetectDeps): Promise<boolean> {
  const lookup = process.platform === 'win32' ? 'where' : 'which'
  return new Promise((resolve) => {
    let settled = false
    const done = (found: boolean): void => {
      if (settled) return
      settled = true
      resolve(found)
    }
    const proc = deps.spawn(lookup, [binary])
    // A spawn error (e.g. the lookup tool itself missing) → treat as absent.
    proc.on('error', () => done(false))
    proc.on('close', (code) => done(code === 0))
  })
}

/** Detect which cloud-CLI summary providers are installed on this machine. */
export async function detectProviders(
  deps: DetectDeps
): Promise<{ claude: boolean; codex: boolean }> {
  const [claude, codex] = await Promise.all([probe('claude', deps), probe('codex', deps)])
  return { claude, codex }
}
