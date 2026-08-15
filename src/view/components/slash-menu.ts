/**
 * The inline slash-command menu (cc/pi style): a non-focus-stealing overlay
 * anchored above the composer. The typed `/query` STAYS in the editor; this
 * component only renders the filtered command list — the editor keeps every
 * keystroke, and the app's global listener routes Up/Down/Esc/Tab.
 *
 * The menu scrolls: Up/Down move the selection and the 8-row window follows
 * it, and while the menu is open the mouse wheel scrolls the MENU (the app
 * routes wheel events here instead of the transcript).
 * @module dsh-tui-app/view/components/slash-menu
 */

import { truncateToWidth } from '@earendil-works/pi-tui'
import type { Component } from '@earendil-works/pi-tui'
import { bg, bold, fg } from '../../app/pi/color.ts'
import { strings } from '../strings.ts'

export interface SlashMenuItem {
  /** Command name without the leading slash (e.g. `model`). */
  name: string
  /** The `/name <hint>` label fragment shown after the name. */
  hint?: string
  description?: string
}

/** Rows visible in the menu window at once. */
const MENU_ROWS = 8

export class SlashMenu implements Component {
  constructor(private items: readonly SlashMenuItem[]) {}

  /** Zero-based selected row (clamped at render). */
  selectedIndex = 0

  /** Replace the filtered items in place (the overlay holds this instance). */
  setItems(items: readonly SlashMenuItem[]): void {
    this.items = items
  }

  /** Move the selection by `delta` rows (mouse wheel route), clamped. */
  scrollBy(delta: number): void {
    this.selectedIndex = Math.min(
      Math.max(0, this.selectedIndex + delta),
      Math.max(0, this.items.length - 1),
    )
  }

  invalidate(): void {
    // Pure render over the current items/selection.
  }

  render(width: number): string[] {
    if (this.items.length === 0) {
      return [truncateToWidth(fg('muted')('  无匹配命令'), width)]
    }
    // The window follows the selection (Up/Down or wheel), so the selected
    // row is always visible when the list overflows the window.
    const maxStart = Math.max(0, this.items.length - MENU_ROWS)
    const start = Math.min(Math.max(0, this.selectedIndex - 3), maxStart)
    const visible = this.items.slice(start, start + MENU_ROWS)
    const lines: string[] = []
    if (start > 0) {
      lines.push(truncateToWidth(fg('dim')(`  ↑ 还有 ${start} 条`), width))
    }
    for (let i = 0; i < visible.length; i++) {
      const item = visible[i]
      const selected = start + i === this.selectedIndex
      const label = ` /${item.name}${item.hint === undefined ? '' : ` ${item.hint}`}`
      const head = selected
        ? bg('selectedBg')(bold(fg('accent')(`❯${label}`)))
        : `  ${fg('text')(label)}`
      const tail = item.description === undefined ? '' : `  ${fg('dim')(item.description)}`
      lines.push(truncateToWidth(`${head}${tail}`, width))
    }
    const remaining = this.items.length - (start + visible.length)
    if (remaining > 0) {
      const more = strings().search === '搜索'
        ? `  ↓ 还有 ${remaining} 条 · 继续输入缩小范围`
        : `  ↓${remaining} more · keep typing to narrow`
      lines.push(truncateToWidth(fg('dim')(more), width))
    }
    const hint = strings().search === '搜索'
      ? '  ↑/↓ 选择 · Tab 补全 · Enter 执行 · Esc 取消'
      : '  ↑/↓ select · Tab complete · Enter run · Esc cancel'
    lines.push(truncateToWidth(fg('dim')(hint), width))
    return lines
  }
}
