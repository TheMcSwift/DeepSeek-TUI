/**
 * One-line notice rendering for system facts and fallback turn outcomes,
 * tone-colored. Consecutive same-group notices converge into one row with a
 * ×N count (P1) — the document stays append-only; only the view merges.
 * @module dsh-tui-app/view/components/notice-view
 */

import { matchesKey, truncateToWidth } from '@earendil-works/pi-tui'
import type { Component, Focusable } from '@earendil-works/pi-tui'
import { fg } from '../../app/pi/color.ts'
import type { NoticeEntry, ViewEntry } from '../../document/document.ts'

/**
 * Merge consecutive same-group notices: the first entry keeps its identity
 * (stable id/focus), the last one's text wins, and `count` records how many
 * rows collapsed. Group-less notices and interleaved non-notice entries
 * break the run — the view never reorders the transcript.
 */
export function convergeNotices(entries: readonly ViewEntry[]): ViewEntry[] {
  const out: ViewEntry[] = []
  for (const entry of entries) {
    const previous = out.at(-1)
    if (
      entry.kind === 'notice' && entry.group !== undefined
      && previous?.kind === 'notice' && previous.group === entry.group
    ) {
      out[out.length - 1] = { ...previous, text: entry.text, count: (previous.count ?? 1) + 1 }
    } else {
      out.push(entry)
    }
  }
  return out
}

export class NoticeEntryView implements Component {
  private entry: NoticeEntry

  constructor(entry: NoticeEntry) {
    this.entry = entry
  }

  setEntry(entry: NoticeEntry): void {
    this.entry = entry
  }

  invalidate(): void {
    // No cached state to invalidate.
  }

  render(width: number): string[] {
    const entry = this.entry
    const mark = entry.tone === 'error'
      ? fg('error')('✗')
      : entry.tone === 'success' ? fg('success')('✓') : fg('info')('ℹ')
    const text = entry.tone === 'error'
      ? fg('error')(entry.text)
      : entry.tone === 'success' ? fg('success')(entry.text) : fg('muted')(entry.text)
    const count = entry.count !== undefined && entry.count > 1 ? fg('dim')(` ×${entry.count}`) : ''
    return [truncateToWidth(`${mark} ${text}${count}`, width)]
  }
}

/** Detail-line cap for expanded injected-context rows (E12). */
const DETAIL_LINE_CAP = 12

/**
 * Focusable notice with a body: the injected-context rows (E12). The row
 * renders as a normal notice; focusing it and pressing Enter expands the
 * full injected text under it, web disclosure-row style.
 */
export class ExpandableNoticeView implements Component, Focusable {
  focused = false
  private expanded = false
  private readonly row: NoticeEntryView
  /** Toggle icon position from the last render (row 0 tail), for clicks. */
  private iconRow = 0
  private iconCol = 0

  constructor(private entry: NoticeEntry) {
    this.row = new NoticeEntryView(entry)
  }

  setEntry(entry: NoticeEntry): void {
    this.entry = entry
    this.row.setEntry(entry)
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'enter')) this.expanded = !this.expanded
  }

  /** True when the click lands on the small expand icon. */
  clickIcon(row: number, col: number): boolean {
    if (row !== this.iconRow) return false
    return col >= this.iconCol && col <= this.iconCol + 1
  }

  invalidate(): void {
    this.row.invalidate()
  }

  render(width: number): string[] {
    const lines = [...this.row.render(width)]
    // Small expand icon at the end of the notice row.
    this.iconRow = 0
    this.iconCol = Math.max(0, width - 1)
    if (lines.length > 0) {
      lines[0] = `${truncateToWidth(lines[0], Math.max(1, width - 2))}${fg('dim')('⏎')}`
    }
    const detail = this.entry.detail
    if (this.expanded && detail !== undefined && detail !== '') {
      const rows = detail.split('\n')
      for (const line of rows.slice(0, DETAIL_LINE_CAP)) {
        lines.push(truncateToWidth(`${fg('dim')('  │')} ${fg('muted')(line)}`, width))
      }
      if (rows.length > DETAIL_LINE_CAP) {
        lines.push(truncateToWidth(fg('dim')(`  … 还有 ${rows.length - DETAIL_LINE_CAP} 行`), width))
      }
    }
    if (this.focused) {
      lines.push(truncateToWidth(`${fg('accent')('  ▸')} ${fg('dim')('注入内容 · ⏎ 展开/收起 · Esc 返回输入')}`, width))
    }
    return lines
  }
}
