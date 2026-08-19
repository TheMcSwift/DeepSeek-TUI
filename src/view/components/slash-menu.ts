/**
 * The inline slash-command menu (cc/pi style): a non-focus-stealing overlay
 * anchored above the composer. The typed `/query` STAYS in the editor; this
 * component only renders the filtered command list — the editor keeps every
 * keystroke, and the app's global listener routes Up/Down/Esc/Tab.
 *
 * 广义交互层（slash 语式的样式维度）：`plain`（cc：无边框行，名称/提示/描述
 * 宽松内联）与 `boxed`（pi：圆角框 + 紧凑行，pi SelectList 视觉）。
 * opencode 预设不渲染本组件（slash: panel，命令走 Ctrl+P）。
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
  /** 广义交互层样式：plain = cc 无边框，boxed = pi 圆角框。 */
  constructor(
    private items: readonly SlashMenuItem[],
    private readonly style: 'plain' | 'boxed' = 'plain',
  ) {}

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
    const boxed = this.style === 'boxed'
    const frame = fg('borderAccent')
    const inner = Math.max(8, width - 2)
    const lines: string[] = []
    const push = (text: string): void => {
      lines.push(boxed ? `${frame('│')} ${truncateToWidth(text, inner - 1)}${frame('│')}` : truncateToWidth(text, width))
    }
    if (boxed) lines.push(`${frame('╭')}${'─'.repeat(inner)}${frame('╮')}`)
    if (this.items.length === 0) {
      push(fg('muted')(strings().slashNoMatch))
      if (boxed) lines.push(`${frame('╰')}${'─'.repeat(inner)}${frame('╯')}`)
      return lines
    }
    // The window follows the selection (Up/Down or wheel), so the selected
    // row is always visible when the list overflows the window.
    const maxStart = Math.max(0, this.items.length - MENU_ROWS)
    const start = Math.min(Math.max(0, this.selectedIndex - 3), maxStart)
    const visible = this.items.slice(start, start + MENU_ROWS)
    if (start > 0) {
      push(fg('dim')(`↑ 还有 ${start} 条`))
    }
    for (let i = 0; i < visible.length; i++) {
      const item = visible[i]
      const selected = start + i === this.selectedIndex
      const label = ` /${item.name}${item.hint === undefined ? '' : ` ${item.hint}`}`
      const head = selected
        ? bg('selectedBg')(bold(fg('accent')(`❯${label}`)))
        : `  ${fg('text')(label)}`
      const tail = item.description === undefined ? '' : `  ${fg('dim')(item.description)}`
      push(`${head}${tail}`)
    }
    const remaining = this.items.length - (start + visible.length)
    if (remaining > 0) {
      push(fg('dim')(strings().slashMore(remaining)))
    }
    push(fg('dim')(strings().slashHint))
    if (boxed) lines.push(`${frame('╰')}${'─'.repeat(inner)}${frame('╯')}`)
    return lines
  }
}
