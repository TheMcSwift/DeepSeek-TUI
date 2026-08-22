/**
 * The `/tips` reference panel (A18): grouped free-form hint lines shown as a
 * focusable overlay above the composer — the same windowed list pattern as
 * HotkeysPanel (its own Up/Down/PgUp/PgDn scrolling), but with single-column
 * text lines instead of aligned key/action columns.
 * @module dsh-tui-app/view/components/tips-panel
 */

import { matchesKey, truncateToWidth } from '@earendil-works/pi-tui'
import type { Component, Focusable } from '@earendil-works/pi-tui'
import { bold, fg } from '../../app/pi/color.ts'
import { strings } from '../strings.ts'
import type { TipGroup } from '../strings.ts'

/** Rows visible in the panel window at once (the overlay clips the rest). */
const VISIBLE_ROWS = 10

type Row =
  | { kind: 'header'; title: string }
  | { kind: 'entry'; text: string }

export class TipsPanel implements Component, Focusable {
  focused = false
  /** Zero-based first flattened row in the visible window. */
  private offset = 0

  constructor(
    private readonly groups: readonly TipGroup[],
    private readonly onClose: () => void,
  ) {}

  private flatten(): Row[] {
    const rows: Row[] = []
    for (const group of this.groups) {
      rows.push({ kind: 'header', title: group.title })
      for (const line of group.lines) rows.push({ kind: 'entry', text: line })
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
    // Pure render over the groups and window offset.
  }

  render(width: number): string[] {
    const rows = this.flatten()
    const maxEnd = Math.max(0, rows.length - VISIBLE_ROWS)
    const start = Math.min(this.offset, maxEnd)
    const visible = rows.slice(start, start + VISIBLE_ROWS)
    const lines: string[] = [
      `${fg('accent')('▸')} ${bold(fg('text')(strings().tipsTitle))}`,
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
      lines.push(truncateToWidth(`  ${fg('text')(row.text)}`, width))
    }
    const remaining = rows.length - (start + visible.length)
    if (remaining > 0) {
      lines.push(truncateToWidth(fg('dim')(`  ↓ 还有 ${remaining} 条`), width))
    }
    lines.push(truncateToWidth(fg('dim')(strings().tipsHint), width))
    return lines
  }
}
