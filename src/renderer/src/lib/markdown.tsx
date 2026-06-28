// Minimal, SAFE markdown → React renderer for AI summary output.
//
// The summary text is model output that may originate off-machine, so it is
// NEVER trusted as HTML: we tokenize to a plain AST and map that AST to React
// elements. There is no dangerouslySetInnerHTML anywhere — raw HTML in the
// source is rendered as literal text, not parsed.
//
// Supported syntax (anything else degrades to plain text):
//   #/##/### headings · -/* unordered lists · 1. ordered lists ·
//   **bold** · *italic* · `code` · blank-line-separated paragraphs.
//
// The parse* functions are pure (no JSX, no React) so they can be unit-tested
// in the node test environment; <Markdown> maps their AST to elements.

import type { JSX, ReactNode } from 'react'

// --- inline AST ---------------------------------------------------------------

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'strong'; value: string }
  | { type: 'em'; value: string }
  | { type: 'code'; value: string }

// --- block AST ----------------------------------------------------------------

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; inline: InlineNode[] }
  | { type: 'ul'; items: InlineNode[][] }
  | { type: 'ol'; items: InlineNode[][] }
  | { type: 'p'; inline: InlineNode[] }

/**
 * Tokenize a single line of inline markdown into text/strong/em/code nodes.
 *
 * Single forward pass — no regex, so there is no catastrophic-backtracking
 * risk on adversarial input. Markers: `` `code` `` (highest precedence, no
 * nesting), `**bold**`, `*italic*`. An unterminated marker degrades to literal
 * text (the marker char is emitted as-is and scanning continues).
 */
export function parseInline(line: string): InlineNode[] {
  const nodes: InlineNode[] = []
  let buf = ''

  const flush = (): void => {
    if (buf) {
      nodes.push({ type: 'text', value: buf })
      buf = ''
    }
  }

  let i = 0
  const n = line.length
  while (i < n) {
    const ch = line[i]

    // Inline code: spans to the next backtick; no inner markup is parsed.
    if (ch === '`') {
      const end = line.indexOf('`', i + 1)
      if (end !== -1) {
        flush()
        nodes.push({ type: 'code', value: line.slice(i + 1, end) })
        i = end + 1
        continue
      }
      // Unterminated — literal backtick.
      buf += ch
      i += 1
      continue
    }

    // Bold: ** … ** (checked before single * so we don't mis-read it as italic).
    if (ch === '*' && line[i + 1] === '*') {
      const end = line.indexOf('**', i + 2)
      if (end !== -1 && end > i + 2) {
        flush()
        nodes.push({ type: 'strong', value: line.slice(i + 2, end) })
        i = end + 2
        continue
      }
      buf += ch
      i += 1
      continue
    }

    // Italic: * … *
    if (ch === '*') {
      const end = line.indexOf('*', i + 1)
      if (end !== -1 && end > i + 1) {
        flush()
        nodes.push({ type: 'em', value: line.slice(i + 1, end) })
        i = end + 1
        continue
      }
      buf += ch
      i += 1
      continue
    }

    buf += ch
    i += 1
  }

  flush()
  return nodes
}

const HEADING_RE = /^(#{1,3})\s+(.*)$/
const UL_RE = /^[-*]\s+(.*)$/
const OL_RE = /^\d+\.\s+(.*)$/

/**
 * Parse a full markdown document into a flat list of block nodes.
 *
 * Blank lines separate paragraphs/lists. Consecutive `-`/`*` lines collapse
 * into one `ul`; consecutive `1.`-style lines into one `ol`. Consecutive plain
 * lines join into a single paragraph (soft-wrapped). Headings are always their
 * own block.
 */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.replace(/\r\n/g, '\n').split('\n')

  let para: string[] = []
  let ul: InlineNode[][] = []
  let ol: InlineNode[][] = []

  const flushPara = (): void => {
    if (para.length) {
      blocks.push({ type: 'p', inline: parseInline(para.join(' ')) })
      para = []
    }
  }
  const flushUl = (): void => {
    if (ul.length) {
      blocks.push({ type: 'ul', items: ul })
      ul = []
    }
  }
  const flushOl = (): void => {
    if (ol.length) {
      blocks.push({ type: 'ol', items: ol })
      ol = []
    }
  }
  const flushAll = (): void => {
    flushPara()
    flushUl()
    flushOl()
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    if (line.trim() === '') {
      flushAll()
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading) {
      flushAll()
      const level = heading[1].length as 1 | 2 | 3
      blocks.push({ type: 'heading', level, inline: parseInline(heading[2]) })
      continue
    }

    const ulItem = UL_RE.exec(line)
    if (ulItem) {
      flushPara()
      flushOl()
      ul.push(parseInline(ulItem[1]))
      continue
    }

    const olItem = OL_RE.exec(line)
    if (olItem) {
      flushPara()
      flushUl()
      ol.push(parseInline(olItem[1]))
      continue
    }

    // Plain text — part of a paragraph.
    flushUl()
    flushOl()
    para.push(line.trim())
  }

  flushAll()
  return blocks
}

// --- rendering ----------------------------------------------------------------

function renderInline(nodes: InlineNode[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'strong':
        return (
          <strong key={i} className="font-semibold text-foreground">
            {node.value}
          </strong>
        )
      case 'em':
        return (
          <em key={i} className="italic">
            {node.value}
          </em>
        )
      case 'code':
        return (
          <code
            key={i}
            className="rounded bg-accent px-1 py-0.5 font-mono text-[0.85em] text-foreground"
          >
            {node.value}
          </code>
        )
      default:
        return <span key={i}>{node.value}</span>
    }
  })
}

const HEADING_CLASS: Record<1 | 2 | 3, string> = {
  1: 'mt-4 mb-2 text-base font-semibold text-foreground first:mt-0',
  2: 'mt-4 mb-1.5 text-sm font-semibold text-foreground first:mt-0',
  3: 'mt-3 mb-1 text-sm font-medium text-foreground first:mt-0'
}

/**
 * Render markdown text to React elements. No HTML injection: the input is
 * parsed to an AST and mapped to elements, never assigned as innerHTML.
 */
export function Markdown({ text }: { text: string }): JSX.Element {
  const blocks = parseBlocks(text)

  return (
    <div className="text-sm leading-relaxed text-muted-foreground">
      {blocks.map((block, i) => {
        switch (block.type) {
          case 'heading': {
            const Tag = (`h${block.level}` as 'h1' | 'h2' | 'h3')
            return (
              <Tag key={i} className={HEADING_CLASS[block.level]}>
                {renderInline(block.inline)}
              </Tag>
            )
          }
          case 'ul':
            return (
              <ul key={i} className="my-2 list-disc space-y-1 pl-5 first:mt-0">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={i} className="my-2 list-decimal space-y-1 pl-5 first:mt-0">
                {block.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ol>
            )
          default:
            return (
              <p key={i} className="my-2 first:mt-0 last:mb-0">
                {renderInline(block.inline)}
              </p>
            )
        }
      })}
    </div>
  )
}
