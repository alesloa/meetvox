// Pure-AST tests for the markdown parser. The <Markdown> component itself needs
// a DOM and isn't exercised here (vitest runs in the node environment); these
// cover the tokenizer/blocker that produce the AST it maps to elements.

import { parseInline, parseBlocks } from './markdown'

describe('parseInline', () => {
  test('**x** → a strong node', () => {
    expect(parseInline('**x**')).toEqual([{ type: 'strong', value: 'x' }])
  })

  test('*x* → an em node', () => {
    expect(parseInline('*x*')).toEqual([{ type: 'em', value: 'x' }])
  })

  test('`x` → a code node', () => {
    expect(parseInline('`x`')).toEqual([{ type: 'code', value: 'x' }])
  })

  test('mixes text and markers in order', () => {
    expect(parseInline('a **b** c')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'strong', value: 'b' },
      { type: 'text', value: ' c' }
    ])
  })

  test('does not read ** as italic', () => {
    expect(parseInline('**bold**')).toEqual([{ type: 'strong', value: 'bold' }])
  })

  test('unterminated marker degrades to literal text', () => {
    expect(parseInline('a *b')).toEqual([{ type: 'text', value: 'a *b' }])
  })

  test('code is not re-parsed for inner markup', () => {
    expect(parseInline('`a*b`')).toEqual([{ type: 'code', value: 'a*b' }])
  })

  test('plain text passes through', () => {
    expect(parseInline('hello world')).toEqual([{ type: 'text', value: 'hello world' }])
  })
})

describe('parseBlocks', () => {
  test('# H → a level-1 heading', () => {
    expect(parseBlocks('# H')).toEqual([
      { type: 'heading', level: 1, inline: [{ type: 'text', value: 'H' }] }
    ])
  })

  test('### levels are captured', () => {
    const blocks = parseBlocks('### Deep')
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 3 })
  })

  test('consecutive - lines collapse into one ul', () => {
    const blocks = parseBlocks('- a\n- b')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: 'ul', items: [[{ value: 'a' }], [{ value: 'b' }]] })
  })

  test('* bullets also produce a ul', () => {
    const blocks = parseBlocks('* a\n* b')
    expect(blocks[0]).toMatchObject({ type: 'ul' })
  })

  test('1. lines produce an ol', () => {
    const blocks = parseBlocks('1. a\n2. b')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ type: 'ol' })
  })

  test('blank line separates paragraphs', () => {
    const blocks = parseBlocks('one\n\ntwo')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ type: 'p' })
    expect(blocks[1]).toMatchObject({ type: 'p' })
  })

  test('soft-wrapped lines join into one paragraph', () => {
    const blocks = parseBlocks('one\ntwo')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toEqual({ type: 'p', inline: [{ type: 'text', value: 'one two' }] })
  })

  test('inline markup is parsed inside a bullet', () => {
    const blocks = parseBlocks('- **bold** item')
    expect(blocks[0]).toMatchObject({
      type: 'ul',
      items: [[{ type: 'strong', value: 'bold' }, { type: 'text', value: ' item' }]]
    })
  })

  test('handles CRLF newlines', () => {
    const blocks = parseBlocks('# H\r\n\r\nbody')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ type: 'heading' })
  })

  test('empty input → no blocks', () => {
    expect(parseBlocks('')).toEqual([])
  })
})
