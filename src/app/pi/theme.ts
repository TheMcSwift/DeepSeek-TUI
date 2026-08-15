/**
 * Composed pi-tui themes built from the vendored pi palette, including
 * hljs-based code highlighting (the pi markdown theme wires highlight.js
 * through the palette in the same way).
 * @module dsh-tui-app/app/pi/theme
 */

import type { EditorTheme, MarkdownTheme, SelectListTheme } from '@earendil-works/pi-tui'
import { bg, bold, fg, italic, strikethrough, underline } from './color.ts'
import { highlight } from './highlight.ts'
import type { HighlightTheme } from './highlight.ts'

const SYNTAX_THEME: HighlightTheme = {
  comment: fg('syntaxComment'),
  keyword: fg('syntaxKeyword'),
  built_in: fg('syntaxKeyword'),
  literal: fg('syntaxKeyword'),
  'title.function': fg('syntaxFunction'),
  'title.class': fg('syntaxType'),
  function: fg('syntaxFunction'),
  variable: fg('syntaxVariable'),
  params: fg('syntaxVariable'),
  string: fg('syntaxString'),
  number: fg('syntaxNumber'),
  type: fg('syntaxType'),
  operator: fg('syntaxOperator'),
  punctuation: fg('syntaxPunctuation'),
  default: (text: string) => text,
}

/** The complete markdown theme, with code blocks highlighted via hljs. */
export function getMarkdownTheme(): MarkdownTheme {
  return {
    heading: (text: string) => bold(fg('mdHeading')(text)),
    link: (text: string) => underline(fg('mdLink')(text)),
    linkUrl: (text: string) => fg('mdLinkUrl')(text),
    code: (text: string) => fg('mdCode')(text),
    codeBlock: (text: string) => fg('mdCodeBlock')(text),
    codeBlockBorder: (text: string) => fg('mdCodeBlockBorder')(text),
    quote: (text: string) => fg('mdQuote')(text),
    quoteBorder: (text: string) => fg('mdQuoteBorder')(text),
    hr: (text: string) => fg('mdHr')(text),
    // Unordered lists render the web's disc bullet (•) instead of the
    // markdown source marker (`- `); ordered lists and task markers keep
    // their shape (`- [x] ` → `• [x] `).
    listBullet: (text: string) => fg('mdListBullet')(text.startsWith('- ') ? `• ${text.slice(2)}` : text),
    bold,
    italic,
    strikethrough,
    underline,
    highlightCode: (code: string, lang?: string) => {
      const html = lang !== undefined && lang !== ''
        ? highlight(code, { language: lang, ignoreIllegals: true, theme: SYNTAX_THEME })
        : highlight(code, { ignoreIllegals: true, theme: SYNTAX_THEME })
      return html.split('\n')
    },
    codeBlockIndent: '  ',
  }
}

/** Select-list theme on the pi palette. */
export function getSelectListTheme(): SelectListTheme {
  return {
    selectedPrefix: (text: string) => fg('accent')(text),
    selectedText: (text: string) => bg('selectedBg')(bold(text)),
    description: (text: string) => fg('muted')(text),
    scrollInfo: (text: string) => fg('dim')(text),
    noMatch: (text: string) => fg('muted')(text),
  }
}

/** Editor theme on the pi palette. */
export function getEditorTheme(): EditorTheme {
  return {
    borderColor: (text: string) => fg('borderAccent')(text),
    selectList: getSelectListTheme(),
  }
}

/** Shared instance helpers for the surface. */
export const theme = {
  fg,
  bg,
  bold,
  underline,
}
