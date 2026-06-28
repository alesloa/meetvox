// Summary orchestrator: read a meeting's transcript, run it through the enabled
// AI provider, cache the result as summary.json, and return it.
//
// SECURITY / PRIVACY: API and cloud-CLI providers send transcript text OFF the
// machine — the only break from Meetvox's otherwise local-only posture. The
// renderer shows a privacy note before enabling a network provider (Phase 8 UI).
// The provider key (API kinds) is read from the safeStorage vault via the
// injected getSecret and used ONLY in a request header — never logged, never in
// a URL. The prompt/transcript body is never logged.

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { loadSettings, getSecret, type SecretStorage } from '../settings'
import { pick } from './providers'
import {
  buildSummaryPrompt,
  needsMapReduce,
  chunkTranscript,
  DEFAULT_SUMMARY_INSTRUCTION
} from './prompt'
import { complete, type CompleteDeps } from './complete'
import type { ProviderConfig, Summary } from './types'
import type { TranscriptEntry } from '@shared/types'

/** Instruction used for the final reduce step that merges per-chunk summaries. */
const COMBINE_INSTRUCTION =
  'These are summaries of consecutive sections of one meeting transcript, in order. ' +
  'Combine them into a single coherent meeting summary. Provide: (1) a short overview, ' +
  '(2) the key discussion points, (3) any decisions made, and ' +
  '(4) action items with owners where mentioned. Do not repeat points across sections.'

const SECTION_SEPARATOR = '\n\n---\n\n'

export interface GenerateSummaryDeps {
  meetingDir: string
  userDataDir: string
  storage: SecretStorage
  spawn: typeof import('child_process').spawn
  fetch: typeof fetch
  now: () => Date
}

/** Read and parse a meeting's transcript.json into entries (or null if absent/bad). */
function readTranscript(meetingDir: string): TranscriptEntry[] | null {
  const path = join(meetingDir, 'transcript.json')
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(parsed) ? (parsed as TranscriptEntry[]) : null
  } catch {
    return null
  }
}

/** Run the map-reduce path: summarize each chunk, then combine the partials. */
async function mapReduce(
  provider: ProviderConfig,
  entries: TranscriptEntry[],
  deps: CompleteDeps
): Promise<string> {
  const chunks = chunkTranscript(entries)
  const partials: string[] = []
  // Sequential — one provider call at a time keeps memory + rate limits sane.
  for (const chunk of chunks) {
    const prompt = buildSummaryPrompt(chunk, DEFAULT_SUMMARY_INSTRUCTION)
    partials.push(await complete(provider, prompt, deps))
  }
  // Single combine pass. The concatenated partials only exceed SUMMARY_CHAR_BUDGET
  // for absurdly long meetings (each partial is itself a short summary, so this
  // would need many tens of hours of speech); a recursive reduce isn't worth the
  // complexity for that. If it ever becomes reachable, recurse here.
  const finalPrompt = `${COMBINE_INSTRUCTION}${SECTION_SEPARATOR}${partials.join(SECTION_SEPARATOR)}`
  return complete(provider, finalPrompt, deps)
}

/**
 * Generate (and cache) a summary for the meeting at `meetingDir`.
 *
 * Throws a clear, user-facing message when there's nothing to summarize, no
 * provider is enabled, or an API provider is missing its key. Network/CLI errors
 * from the provider propagate so the UI can show them.
 */
export async function generateSummary(deps: GenerateSummaryDeps): Promise<Summary> {
  const { meetingDir, userDataDir, storage, spawn, fetch, now } = deps

  const entries = readTranscript(meetingDir)
  if (!entries || entries.length === 0) {
    throw new Error('No transcript to summarize')
  }

  const config = loadSettings(userDataDir).summary
  const provider = pick(config)
  if (!provider) {
    throw new Error('No AI summary provider is enabled — configure one in Settings')
  }

  const completeDeps: CompleteDeps = {
    spawn,
    fetch,
    getSecret: (id) => getSecret(userDataDir, id, storage)
  }

  const prompt = buildSummaryPrompt(entries, DEFAULT_SUMMARY_INSTRUCTION)
  const text = needsMapReduce(prompt)
    ? await mapReduce(provider, entries, completeDeps)
    : await complete(provider, prompt, completeDeps)

  const summary: Summary = {
    text,
    provider: provider.id,
    model: provider.model ?? null,
    generatedAt: now().toISOString()
  }

  writeFileSync(join(meetingDir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8')
  return summary
}

/** Read the cached summary.json for a meeting, or null if absent/malformed. */
export function getSummary(meetingDir: string): Summary | null {
  const path = join(meetingDir, 'summary.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Summary
  } catch {
    return null
  }
}
