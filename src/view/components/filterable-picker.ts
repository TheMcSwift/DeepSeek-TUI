/**
 * A picker overlay panel with live search: every printable keystroke filters
 * the rows by label/value (substring match) and resets the selection, so long
 * lists — sessions, models, permission presets — stay navigable without
 * arrows-only scrolling. The panel owns keyboard focus while the overlay is
 * open (the same DialogPanel identity trick the approval dialog uses), so
 * hide() restores the composer focus cleanly.
 * @module dsh-tui-app/view/components/filterable-picker
 */

import { SelectList, Text } from '@earendil-works/pi-tui'
import type { Component, Focusable } from '@earendil-works/pi-tui'
import { fg } from '../../app/pi/color.ts'
import { getSelectListTheme } from '../theme/theme.ts'
import { strings } from '../strings.ts'

/** One searchable row; `value` is what the callback receives. */
export interface PickerRow {
  value: string
  label: string
  description?: string
  /** The app marks the currently selected row with a bullet. */
  current?: boolean
}

export class FilterablePickerPanel implements Component, Focusable {
  focused = false

  private query = ''
  private rows: readonly PickerRow[]
  private remoteRows = false
  private list: SelectList
  private readonly hint: Text
  private readonly onFilter: ((query: string) => void) | undefined
  private readonly onActivity: (() => void) | undefined

  constructor(
    private readonly title: string,
    rows: readonly PickerRow[],
    /** Resolves with the picked row's `value`; called with `null` on cancel. */
    private readonly onPick: (value: string | null) => void,
    /** Reports each filter change; the app feeds remote results back via setRows (H5). */
    onFilter?: (query: string) => void,
    /** Reports every keystroke (arrows included); the runner pauses idle backfill. */
    onActivity?: () => void,
  ) {
    this.rows = rows
    this.onFilter = onFilter
    this.onActivity = onActivity
    this.list = this.buildList(rows)
    this.hint = new Text(fg('dim')('输入即过滤 · ↑/↓ 选择 · Enter 确认 · Esc 取消'), 0, 0)
  }

  /** Replace the rows (e.g. backend full-text search results) keeping the query.
   *  Remote rows already matched the query server-side, so the local label
   *  filter is bypassed until the next keystroke. */
  setRows(rows: readonly PickerRow[]): void {
    this.rows = rows
    this.remoteRows = true
    this.list = this.buildList(rows)
    this.invalidate()
  }

  private applyQuery(next: string): void {
    this.query = next
    this.remoteRows = false
    this.list = this.buildList(this.rows)
    this.invalidate()
    this.onFilter?.(next)
  }

  /** Rebuild the SelectList for the current query; item value = row index. */
  private buildList(rows: readonly PickerRow[]): SelectList {
    const query = this.query.toLowerCase()
    // Label-only match: `value` is an opaque id (session ids, provider/model
    // keys) that would produce surprising substring hits (e.g. 'session-abc'
    // matching a query of 'b'). Remote rows skip the filter (already matched).
    const matches = query === '' || this.remoteRows
      ? [...rows]
      : rows.filter(row => row.label.toLowerCase().includes(query))
    const list = new SelectList(
      matches.map((row, index) => ({ value: String(index), label: row.label, description: row.description })),
      10,
      getSelectListTheme(),
    )
    list.onSelect = (item) => { this.onPick(matches[Number(item.value)]?.value ?? null) }
    list.onCancel = () => { this.onPick(null) }
    return list
  }

  handleInput(data: string): void {
    this.onActivity?.()
    if (data === '\x1b') {
      this.onPick(null)
      return
    }
    if (data === '\x7f' || data === '\b') {
      if (this.query === '') return
      this.applyQuery(this.query.slice(0, -1))
      return
    }
    if (data.length === 1 && data >= ' ' && data !== '~') {
      this.applyQuery(this.query + data)
      return
    }
    // Arrows / Enter / other keys: forward to the current list.
    this.list.handleInput(data)
  }

  invalidate(): void {
    this.hint.invalidate()
    this.list.invalidate()
  }

  render(width: number): string[] {
    const querySuffix = this.query === '' ? '' : ` ${fg('accent')(`/${this.query}`)}`
    const hint = strings().search === '搜索'
      ? '输入即过滤 · ↑/↓ 选择 · Enter 确认 · Esc 取消'
      : 'Type to filter · ↑/↓ select · Enter confirm · Esc cancel'
    return [
      `${fg('accent')('▸')} ${fg('text')(this.title)}${querySuffix}`,
      fg('borderMuted')('─'.repeat(Math.max(0, width))),
      ...this.list.render(width),
      hint,
    ]
  }
}
