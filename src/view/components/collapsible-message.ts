/**
 * A collapsible wrapper for long user/assistant messages: renders the first
 * N lines plus a `… M more lines (⏎ 展开)` footer while collapsed, and the
 * inner component verbatim once expanded. It joins the Tab focus cycle like
 * the tool cards, so Enter expands/collapses it without leaving the keyboard
 * (pi-style: the ⏎ icon on the first row is a pure status marker).
 * @module dsh-tui-app/view/components/collapsible-message
 */

import type { Component, Focusable } from '@earendil-works/pi-tui'
import { truncateToWidth } from '@earendil-works/pi-tui'
import { fg } from '../../app/pi/color.ts'

export const LONG_MESSAGE_LINES = 40
const PREVIEW_LINES = 12

/** The status icon rendered at the end of the first row. */
const TOGGLE_ICON = '⏎'

export class CollapsibleMessage implements Component, Focusable {
  focused = false
  /**
   * Long outputs default to EXPANDED: the full text is what the user wants
   * to read, and a collapsed-by-default fold hid the only copy of it. The
   * manual fold stays available (Tab + Enter) for compacting a transcript.
   */
  expanded = true
  private collapsed: string[]
  private totalLines: number

  constructor(private inner: Component, fullText: string) {
    const lines = fullText.split('\n')
    this.totalLines = lines.length
    this.collapsed = lines.slice(0, PREVIEW_LINES)
  }

  /** Swap the inner component (the entry's canonical view recreated). */
  replaceInner(inner: Component, fullText: string): void {
    this.inner = inner
    const lines = fullText.split('\n')
    this.totalLines = lines.length
    this.collapsed = lines.slice(0, PREVIEW_LINES)
    this.invalidate()
  }

  handleInput(data: string): void {
    if (data === '\r') {
      this.expanded = !this.expanded
      this.invalidate()
    }
  }

  invalidate(): void {
    this.inner.invalidate()
  }

  render(width: number): string[] {
    if (this.expanded) {
      const lines = this.inner.render(width)
      if (lines.length === 0) return lines
      // The status icon rides the end of the first row.
      const head = truncateToWidth(lines[0], Math.max(1, width - 2))
      return [`${head}${fg('dim')(TOGGLE_ICON)}`, ...lines.slice(1)]
    }
    const hidden = this.totalLines - this.collapsed.length
    const hint = this.focused
      ? fg('text')(`… 还有 ${hidden} 行（⏎ 展开，再次 ⏎ 收起）`)
      : fg('dim')(`… 还有 ${hidden} 行（⏎ 展开）`)
    const first = truncateToWidth(this.collapsed[0] ?? '', Math.max(1, width - 2))
    return [`${first}${fg('dim')(TOGGLE_ICON)}`, ...this.collapsed.slice(1), hint]
  }
}

/** Wrap `inner` when `text` exceeds the fold threshold; otherwise return it. */
export function maybeCollapse(inner: Component, text: string, enabled = true): Component {
  if (!enabled) return inner
  return text.split('\n').length > LONG_MESSAGE_LINES ? new CollapsibleMessage(inner, text) : inner
}
