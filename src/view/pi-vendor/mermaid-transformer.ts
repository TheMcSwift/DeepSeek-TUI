/**
 * Mermaid → Unicode terminal diagrams (T5⑥), vendored and adapted from
 * earendil-works/pi (MIT):
 * packages/coding-agent/src/modes/interactive/components/mermaid.ts
 * The heavy lifting is `grok-mermaid`; this transformer swaps top-level
 * ```mermaid code blocks for styled box-drawing rows inside inline code
 * spans (pi's codeSpan trick preserves spacing and box characters).
 * @module dsh-tui-app/view/pi-vendor/mermaid-transformer
 */

import { Marked } from '@earendil-works/pi-tui'
import type { Token } from '@earendil-works/pi-tui'
import { render } from 'grok-mermaid'
import type { Span } from 'grok-mermaid'
import type { MarkdownTransformer } from './extensions-types.ts'
import { theme } from '../theme/theme.ts'
import type { Theme } from '../theme/theme.ts'

const markdownParser = new Marked()

function isMermaid(token: Token): token is Token & { type: 'code'; text: string; lang?: string } {
  return token.type === 'code' && token.lang?.trim().split(/\s+/, 1)[0]?.toLowerCase() === 'mermaid'
}

function codeSpan(line: string): string {
  // Encode each diagram row as inline code so Markdown preserves its spacing
  // and box-drawing characters; a non-breaking space keeps blank rows tall.
  const content = line || '\u00a0'
  const longestBacktickRun = Math.max(0, ...Array.from(content.matchAll(/`+/g), (match) => match[0].length))
  const fence = '`'.repeat(longestBacktickRun + 1)
  const padding = content.startsWith('`') || content.endsWith('`') ? ' ' : ''
  return `${fence}${padding}${content}${padding}${fence}`
}

function styleSpan(span: Span, theme: Theme): string {
  switch (span.cls) {
    case 'border':
      return theme.fg('borderMuted', span.text)
    case 'text':
      return theme.fg('text', span.text)
    case 'edge':
      return theme.fg('accent', span.text)
    case 'edgeLabel':
      return theme.fg('muted', span.text)
    case 'title':
      return theme.fg('accent', theme.bold(span.text))
    case 'none':
      return span.text
  }
}

function themedLines(art: { styled: Array<Array<Span>> }, theme: Theme): string[] {
  return art.styled.map(row => row.map(span => styleSpan(span, theme)).join(''))
}

/** Replace top-level ```mermaid blocks with terminal diagrams (T5⑥). */
export function createMermaidMarkdownTransformer(): MarkdownTransformer {
  return (markdown, context) => {
    // Reasoning streams and in-flight deltas stay plain text; diagrams render
    // once the message settles.
    if (context.messageType === 'assistant-thinking' || context.isStreaming) return markdown
    return markdownParser
      .lexer(markdown)
      .map((token) => {
        if (!isMermaid(token)) return token.raw
        const art = render(token.text)
        if (art === null || art.width > context.availableWidth) return token.raw
        if (!context.isStreaming && art.warnings.length > 0) {
          const suffix = art.warnings.length > 1 ? ` (+${art.warnings.length - 1} more)` : ''
          const warning = `Mermaid diagram not rendered: ${art.warnings[0]}${suffix}`
          return `${token.raw}\n${codeSpan(theme.fg('warning', warning))}  \n`
        }
        const lines = themedLines(art, theme)
        // Markdown hard breaks keep every diagram row on its own line.
        return `${lines.map(codeSpan).join('  \n')}\n`
      })
      .join('')
  }
}

/** The singleton transformer every message renderer shares. */
export const mermaidTransformer = createMermaidMarkdownTransformer()
