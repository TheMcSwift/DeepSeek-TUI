/**
 * The `/hotkeys` reference panel: a sectioned, aligned two-column table (key
 * column + action column) shown as a focusable overlay above the composer.
 * The old layout squeezed five run-on ` · `-separated lines into a 72-column
 * card, so CJK rows truncated mid-sentence; this panel gives every binding
 * its own row, aligns the key column by display width, groups bindings under
 * headings, and windows the list with its own Up/Down/PgUp/PgDn scrolling.
 * @module dsh-tui-app/view/components/hotkeys-panel
 */

import { matchesKey, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import type { Component, Focusable } from '@earendil-works/pi-tui'
import { bold, fg } from '../../app/pi/color.ts'
import { strings } from '../strings.ts'
import type { HotkeySection } from '../strings.ts'

/** Rows visible in the panel window at once (the overlay clips the rest). */
const VISIBLE_ROWS = 10

/** One flattened row: a section heading or a key/action entry. */
type Row =
  | { kind: 'header'; title: string }
  | { kind: 'entry'; keys: string; action: string }

/** Pad a text to a target DISPLAY width (CJK keys count double). */
function padTo(text: string, target: number): string {
  return text + ' '.repeat(Math.max(0, target - visibleWidth(text)))
}

export class HotkeysPanel implements Component, Focusable {
  focused = false
  /** Zero-based first flattened row in the visible window. */
  private offset = 0

  constructor(
    private readonly sections: readonly HotkeySection[],
    private readonly onClose: () => void,
  ) {}

  /** Headings interleaved with their entries, in declaration order. */
  private flatten(): Row[] {
    const rows: Row[] = []
    for (const section of this.sections) {
      rows.push({ kind: 'header', title: section.title })
      for (const row of section.rows) rows.push({ kind: 'entry', keys: row.keys, action: row.action })
    }
    return rows
  }

  private totalRows(): number {
    return this.flatten().length
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape') || matchesKey(data, 'enter') || data === 'q') {
      this.onClose()
      return
    }
    if (matchesKey(data, 'up')) {
      this.scrollBy(-1)
      return
    }
    if (matchesKey(data, 'down')) {
      this.scrollBy(1)
      return
    }
    if (matchesKey(data, 'pageUp')) {
      this.scrollBy(-VISIBLE_ROWS)
      return
    }
    if (matchesKey(data, 'pageDown')) {
      this.scrollBy(VISIBLE_ROWS)
    }
  }

  private scrollBy(delta: number): void {
    this.offset = Math.min(
      Math.max(0, this.offset + delta),
      Math.max(0, this.totalRows() - VISIBLE_ROWS),
    )
  }

  invalidate(): void {
    // Pure render over the sections and window offset.
  }

  render(width: number): string[] {
    const rows = this.flatten()
    // The key column takes the widest binding (bounded), so every action
    // starts at the same column.
    const keyWidth = rows.reduce(
      (max, row) => (row.kind === 'entry' ? Math.max(max, visibleWidth(row.keys)) : max),
      0,
    )
    const maxEnd = Math.max(0, rows.length - VISIBLE_ROWS)
    const start = Math.min(this.offset, maxEnd)
    const visible = rows.slice(start, start + VISIBLE_ROWS)
    const lines: string[] = [
      `${fg('accent')('▸')} ${bold(fg('text')(strings().hotkeysTitle))}`,
      fg('borderMuted')('─'.repeat(Math.max(0, width))),
    ]
    if (start > 0) {
      lines.push(truncateToWidth(fg('dim')(`  ↑ 还有 ${start} 条`), width))
    }
    for (const row of visible) {
      if (row.kind === 'header') {
        lines.push(truncateToWidth(` ${bold(fg('accent')(row.title))}`, width))
        continue
      }
      const keys = padTo(row.keys, keyWidth)
      const actionWidth = Math.max(0, width - 2 - keyWidth - 2)
      lines.push(truncateToWidth(
        `  ${fg('accent')(keys)}  ${fg('text')(truncateToWidth(row.action, actionWidth))}`,
        width,
      ))
    }
    const remaining = rows.length - (start + visible.length)
    if (remaining > 0) {
      lines.push(truncateToWidth(fg('dim')(`  ↓ 还有 ${remaining} 条`), width))
    }
    lines.push(truncateToWidth(fg('dim')(strings().hotkeysHint), width))
    return lines
  }
}
