/**
 * The inline slash-command menu (cc/pi/opencode style): a non-focus-stealing
 * overlay anchored above the composer. The typed `/query` STAYS in the editor;
 * this component only renders the filtered command list — the editor keeps
 * every keystroke, and the app's global listener routes Up/Down/Esc/Tab.
 *
 * 广义交互层（slash 语式的样式维度）：
 * - `plain`（cc）：无边框行，名称/提示/描述宽松内联；
 * - `boxed`（pi）：圆角框 + 紧凑行（pi SelectList 视觉）；
 * - `popup`（opencode）：方角框 + 标题计数行 + 整行选中态 + 描述列，底栏点出
 *   Ctrl+P 命令面板（上游 `/` suggestions popup 与 `ctrl+p` command_list 并存）。
 * `panel` 语式（只走命令面板）根本不构造本组件。
 *
 * The menu scrolls: Up/Down move the selection and the 8-row window follows
 * it, and while the menu is open the mouse wheel scrolls the MENU (the app
 * routes wheel events here instead of the transcript).
 * @module dsh-tui-app/view/components/slash-menu
 */

import { truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
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

/** 广义交互层样式：cc 无边框 / pi 圆角框 / opencode 方角弹层。 */
export type SlashMenuStyle = 'plain' | 'boxed' | 'popup'

/** Rows visible in the menu window at once (PgUp/PgDn 也按此翻页). */
export const SLASH_MENU_ROWS = 8

/** 补齐到目标显示宽度（与 settings/hotkeys 面板同一约定）。 */
function padTo(text: string, target: number): string {
  return text + ' '.repeat(Math.max(0, target - visibleWidth(text)))
}

export class SlashMenu implements Component {
  constructor(
    private items: readonly SlashMenuItem[],
    private readonly style: SlashMenuStyle = 'plain',
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
    // cc（plain）语式独立处理：名称列对齐 + 描述列，选中行整行高亮（Claude Code 视觉）。
    if (this.style === 'plain') return this.renderPlain(width)
    // boxed/popup 都带边框，只有边角字符与标题行不同（plain 已在上方返回）。
    const framed = true
    const popup = this.style === 'popup'
    const frame = fg('borderAccent')
    const inner = Math.max(8, width - 2)
    const lines: string[] = []
    const push = (text: string): void => {
      if (!framed) {
        lines.push(truncateToWidth(text, width))
        return
      }
      // 边框语式一律把行补满内宽，右边框才对齐（popup 方角框与 pi 圆角框同规）。
      lines.push(`${frame('│')} ${truncateToWidth(text, inner - 1, '...', true)}${frame('│')}`)
    }
    if (framed) lines.push(this.topBorder(inner, popup))
    if (this.items.length === 0) {
      push(fg('muted')(strings().slashNoMatch))
      if (framed) lines.push(this.bottomBorder(inner, popup))
      return lines
    }
    // The window follows the selection (Up/Down or wheel), so the selected
    // row is always visible when the list overflows the window.
    const maxStart = Math.max(0, this.items.length - SLASH_MENU_ROWS)
    const start = Math.min(Math.max(0, this.selectedIndex - 3), maxStart)
    const visible = this.items.slice(start, start + SLASH_MENU_ROWS)
    if (start > 0) {
      push(fg('dim')(`↑ 还有 ${start} 条`))
    }
    for (let i = 0; i < visible.length; i++) {
      const item = visible[i]
      const selected = start + i === this.selectedIndex
      const label = ` /${item.name}${item.hint === undefined ? '' : ` ${item.hint}`}`
      const tail = item.description === undefined ? '' : `  ${item.description}`
      if (popup) {
        // opencode 语式：选中行整行铺满内宽（先补齐再上色，避免高亮只包住文字）。
        push(selected
          ? bg('selectedBg')(bold(fg('accent')(padTo(`❯${label}${tail}`, inner - 1))))
          : `  ${fg('text')(label)}${fg('dim')(tail)}`)
        continue
      }
      const head = selected
        ? bg('selectedBg')(bold(fg('accent')(`❯${label}`)))
        : `  ${fg('text')(label)}`
      push(`${head}${item.description === undefined ? '' : fg('dim')(tail)}`)
    }
    const remaining = this.items.length - (start + visible.length)
    if (remaining > 0) {
      push(fg('dim')(strings().slashMore(remaining)))
    }
    // popup 语式的底栏点出命令面板入口（opencode 两条入口并存）。
    push(fg('dim')(popup ? strings().slashPopupHint : strings().slashHint))
    if (framed) lines.push(this.bottomBorder(inner, popup))
    return lines
  }

  /**
   * cc（plain）语式：名称列对齐（含参数提示）+ 描述列，选中行整行高亮
   * （Claude Code `/` 补全的视觉——命令名列 + 灰色描述列，选中背景铺满整行）。
   */
  private renderPlain(width: number): string[] {
    const lines: string[] = []
    if (this.items.length === 0) {
      lines.push(truncateToWidth(fg('muted')(strings().slashNoMatch), width))
      return lines
    }
    const maxStart = Math.max(0, this.items.length - SLASH_MENU_ROWS)
    const start = Math.min(Math.max(0, this.selectedIndex - 3), maxStart)
    const visible = this.items.slice(start, start + SLASH_MENU_ROWS)
    if (start > 0) lines.push(truncateToWidth(fg('dim')(`↑ 还有 ${start} 条`), width))
    // 名称列最大宽（`/name <hint>`），描述从对齐列开始。
    const nameWidth = Math.max(...visible.map(item => visibleWidth(`/${item.name}${item.hint === undefined ? '' : ` ${item.hint}`}`)))
    for (let i = 0; i < visible.length; i++) {
      const item = visible[i]
      const selected = start + i === this.selectedIndex
      const label = `/${item.name}${item.hint === undefined ? '' : ` ${item.hint}`}`
      const gap = ' '.repeat(Math.max(0, nameWidth - visibleWidth(label)))
      const desc = item.description === undefined ? '' : item.description
      const descText = desc === '' ? '' : `  ${desc}`
      // 选中：整行背景（名称 accent 粗体 + 描述 dim）；非选中：名称 text + 描述 dim。
      const text = selected
        ? bg('selectedBg')(bold(fg('accent')(`❯${label}`)) + fg('dim')(`${gap}${descText}`))
        : `${fg('text')(`  ${label}`)}${fg('dim')(`${gap}${descText}`)}`
      lines.push(truncateToWidth(text, width))
    }
    const remaining = this.items.length - (start + visible.length)
    if (remaining > 0) lines.push(truncateToWidth(fg('dim')(strings().slashMore(remaining)), width))
    lines.push(truncateToWidth(fg('dim')(strings().slashHint), width))
    return lines
  }

  /** 顶边：popup 把标题计数行嵌进方角边框，boxed 是纯圆角横线。 */
  private topBorder(inner: number, popup: boolean): string {    const frame = fg('borderAccent')
    if (!popup) return `${frame('╭')}${'─'.repeat(inner)}${frame('╮')}`
    const title = strings().slashPopupTitle(this.items.length)
    const fill = Math.max(0, inner - visibleWidth(title) - 3)
    return `${frame('┌─')} ${bold(fg('text')(title))} ${frame(`${'─'.repeat(fill)}┐`)}`
  }

  private bottomBorder(inner: number, popup: boolean): string {
    const frame = fg('borderAccent')
    return `${frame(popup ? '└' : '╰')}${'─'.repeat(inner)}${frame(popup ? '┘' : '╯')}`
  }
}
