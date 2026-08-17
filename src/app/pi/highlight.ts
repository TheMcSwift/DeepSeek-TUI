/**
 * Syntax highlighting vendored from earendil-works/pi (MIT License):
 * packages/coding-agent/src/utils/syntax-highlight.ts + html.ts — highlight.js
 * output is parsed back into scope-styled plain text so terminal colors come
 * from the pi palette instead of hljs CSS classes.
 * @module dsh-tui-app/app/pi/highlight
 */

import hljs from 'highlight.js/lib/core'
import { registerHighlightLanguages } from './highlight-languages.ts'

// 常用语法子集按需注册（见 highlight-languages.ts）：安装体积与 auto 探测
// 耗时都远小于全量包，且未注册的围栏语言不会让 highlight() 抛错。
registerHighlightLanguages(hljs)

export type HighlightFormatter = (text: string) => string
export type HighlightTheme = Partial<Record<string, HighlightFormatter>>

export interface HighlightOptions {
  language?: string
  ignoreIllegals?: boolean
  languageSubset?: string[]
  theme?: HighlightTheme
}

const SPAN_CLOSE = '</span>'
const HIGHLIGHT_CLASS_PREFIX = 'hljs-'

function getScopeFromSpanTag(tag: string): string | undefined {
  const match = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(tag)
  const classValue = match?.[1] ?? match?.[2]
  if (!classValue) {
    return undefined
  }

  for (const className of classValue.split(/\s+/)) {
    if (className.startsWith(HIGHLIGHT_CLASS_PREFIX)) {
      return className.slice(HIGHLIGHT_CLASS_PREFIX.length)
    }
  }
  return undefined
}

function getScopeFormatter(scope: string, theme: HighlightTheme): HighlightFormatter | undefined {
  const exact = theme[scope]
  if (exact) {
    return exact
  }

  const dotIndex = scope.indexOf('.')
  if (dotIndex !== -1) {
    const prefixFormatter = theme[scope.slice(0, dotIndex)]
    if (prefixFormatter) {
      return prefixFormatter
    }
  }

  const dashIndex = scope.indexOf('-')
  if (dashIndex !== -1) {
    const prefixFormatter = theme[scope.slice(0, dashIndex)]
    if (prefixFormatter) {
      return prefixFormatter
    }
  }

  return undefined
}

function getActiveFormatter(scopes: Array<string | undefined>, theme: HighlightTheme): HighlightFormatter | undefined {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i]
    if (!scope) {
      continue
    }
    const formatter = getScopeFormatter(scope, theme)
    if (formatter) {
      return formatter
    }
  }
  return theme.default
}

function isSpanOpenTagStart(html: string, index: number): boolean {
  if (!html.startsWith('<span', index)) {
    return false
  }
  const nextChar = html[index + '<span'.length]
  return nextChar === '>' || nextChar === ' ' || nextChar === '\t' || nextChar === '\n' || nextChar === '\r'
}

/** Decode the named/numeric HTML entity at `index`; `undefined` when none. */
function decodeHtmlEntityAt(html: string, index: number): { text: string; length: number } | undefined {
  const semicolonIndex = html.indexOf(';', index + 1)
  if (semicolonIndex === -1 || semicolonIndex - index > 16) {
    return undefined
  }

  const entity = html.slice(index + 1, semicolonIndex)
  const decoded = decodeHtmlEntity(entity)
  if (decoded === undefined) {
    return undefined
  }

  return { text: decoded, length: semicolonIndex - index + 1 }
}

function decodeHtmlEntity(entity: string): string | undefined {
  switch (entity) {
    case 'amp':
      return '&'
    case 'lt':
      return '<'
    case 'gt':
      return '>'
    case 'quot':
      return '"'
    case 'apos':
      return "'"
  }

  if (entity.startsWith('#x') || entity.startsWith('#X')) {
    return decodeCodePoint(Number.parseInt(entity.slice(2), 16))
  }

  if (entity.startsWith('#')) {
    return decodeCodePoint(Number.parseInt(entity.slice(1), 10))
  }

  return undefined
}

function decodeCodePoint(codePoint: number): string | undefined {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return undefined
  }
  return String.fromCodePoint(codePoint)
}

export function renderHighlightedHtml(html: string, theme: HighlightTheme = {}): string {
  let output = ''
  let textBuffer = ''
  const scopes: Array<string | undefined> = []

  const flushText = () => {
    if (!textBuffer) {
      return
    }
    const formatter = getActiveFormatter(scopes, theme)
    output += formatter ? formatter(textBuffer) : textBuffer
    textBuffer = ''
  }

  let index = 0
  while (index < html.length) {
    if (isSpanOpenTagStart(html, index)) {
      const tagEndIndex = html.indexOf('>', index + 5)
      if (tagEndIndex !== -1) {
        flushText()
        const tag = html.slice(index, tagEndIndex + 1)
        const scope = getScopeFromSpanTag(tag)
        scopes.push(scope)
        index = tagEndIndex + 1
        continue
      }
    }

    if (html.startsWith(SPAN_CLOSE, index)) {
      flushText()
      if (scopes.length > 0) {
        scopes.pop()
      }
      index += SPAN_CLOSE.length
      continue
    }

    if (html[index] === '&') {
      const decoded = decodeHtmlEntityAt(html, index)
      if (decoded) {
        textBuffer += decoded.text
        index += decoded.length
        continue
      }
    }

    textBuffer += html[index]
    index++
  }

  flushText()
  return output
}

/** Highlight `code` with hljs and restyle its output through `theme` formatters. */
export function highlight(code: string, options: HighlightOptions = {}): string {
  // core 子集未注册的围栏语言回退 auto 探测，而不是让 hljs.highlight 抛
  // "Unknown language"（全量构建时代大部分语言都在册，切子集后必须兜底）。
  const language = options.language !== undefined && hljs.getLanguage(options.language) !== undefined
    ? options.language
    : undefined
  const html = language
    ? hljs.highlight(code, {
      language,
      ignoreIllegals: options.ignoreIllegals,
    }).value
    : hljs.highlightAuto(code, options.languageSubset).value
  return renderHighlightedHtml(html, options.theme)
}

export function supportsLanguage(name: string): boolean {
  return hljs.getLanguage(name) !== undefined
}
