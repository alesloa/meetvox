import type { TranscriptEntry } from '@shared/types'

/**
 * Maximum transcript characters fed to a single model call before map-reduce
 * kicks in.  ~100k chars ≈ 25–30k tokens — a safe ceiling that fits modern
 * model context windows while leaving room for the instruction and output.
 * Smaller or older models may need a lower budget; configure in Settings.
 */
export const SUMMARY_CHAR_BUDGET = 100_000

/**
 * Default instruction sent to the model before the transcript.
 * Produces a structured meeting summary covering the four areas most useful
 * after a call: overview, key points, decisions, and action items.
 */
export const DEFAULT_SUMMARY_INSTRUCTION =
  'Summarize this meeting transcript. Provide: (1) a short overview of the meeting, ' +
  '(2) the key discussion points, (3) any decisions made, and ' +
  '(4) action items with owners where mentioned.'

const SEPARATOR = '\n\n---\n\n'

/** Render a single transcript entry as a `Speaker: text` line. */
function renderEntry(entry: TranscriptEntry): string {
  return `${entry.speaker}: ${entry.text}`
}

/**
 * Build the full prompt sent to a model.
 *
 * Format:
 *   <instructions>
 *   ---
 *   <Speaker>: <text>
 *   <Speaker>: <text>
 *   ...
 *
 * Entry order is preserved exactly — never reordered.
 */
export function buildSummaryPrompt(
  entries: TranscriptEntry[],
  instructions: string,
): string {
  const transcript = entries.map(renderEntry).join('\n')
  return `${instructions}${SEPARATOR}${transcript}`
}

/**
 * Return true when `text` exceeds the character budget and map-reduce is
 * required instead of a single model call.
 */
export function needsMapReduce(
  text: string,
  budget: number = SUMMARY_CHAR_BUDGET,
): boolean {
  return text.length > budget
}

/**
 * Split `entries` into consecutive groups where the rendered length of each
 * group (sum of `speaker: text` line lengths) does not exceed `budget`.
 *
 * Rules:
 * - Splitting happens only on entry boundaries — never mid-entry.
 * - A single entry whose rendered length exceeds `budget` is placed in its own
 *   group (it is never dropped).
 * - Concatenating all groups in order yields exactly the original entries
 *   (nothing lost, nothing reordered).
 */
export function chunkTranscript(
  entries: TranscriptEntry[],
  budget: number = SUMMARY_CHAR_BUDGET,
): TranscriptEntry[][] {
  const chunks: TranscriptEntry[][] = []
  let current: TranscriptEntry[] = []
  let currentLen = 0

  for (const entry of entries) {
    const line = renderEntry(entry)
    // Count the '\n' that buildSummaryPrompt joins entries with, so the budget is
    // measured against the actual rendered length (not N*line, which undercounts).
    const addLen = current.length > 0 ? line.length + 1 : line.length

    if (current.length > 0 && currentLen + addLen > budget) {
      chunks.push(current)
      current = []
      currentLen = 0
      current.push(entry)
      currentLen = line.length
      continue
    }

    current.push(entry)
    currentLen += addLen
  }

  if (current.length > 0) {
    chunks.push(current)
  }

  return chunks
}
