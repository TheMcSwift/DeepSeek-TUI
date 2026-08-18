/**
 * /plugins 能力清单（M3，H20/H21 代理视图）：命令/技能/投影三个分区，
 * 窗口滚动 + ↑/↓ + Enter 执行 + Esc 关闭。**纯语义色**，随主题预设
 * （web/cc/pi/opencode）自动换肤。
 *
 * 数据源诚实声明（SETTINGS-WORKSPACE-DESIGN §3.2）：tui profile 挂载
 * dsh-base、无独立插件 registry 服务，因此这是「代理视图」——命令来自
 * ctx.commands、技能来自 ctx.skills、投影来自 sessionProjections 快照，
 * 按来源分区而非按插件归组。
 * @module dsh-tui-app/view/components/plugins-panel
 */

import { matchesKey, truncateToWidth } from '@earendil-works/pi-tui'
import type { Component, Focusable } from '@earendil-works/pi-tui'
import { bold, fg } from '../../app/pi/color.ts'
import type { PluginsRow } from '../../app/terminal-app.ts'
import { strings } from '../strings.ts'

/** Rows visible in the panel window at once (the overlay clips the rest). */
const VISIBLE_ROWS = 12

/** 条目行的色调（header 行无 tone）。 */
type RowTone = Extract<PluginsRow, { kind: 'item' }>['tone']

function toneFormatter(tone: RowTone): (text: string) => string {
  switch (tone) {
    case 'accent': return fg('accent')
    case 'info': return fg('info')
    case 'success': return fg('success')
    case 'warning': return fg('warning')
    case 'error': return fg('error')
    case 'muted': return fg('muted')
    case 'dim': return fg('dim')
    default: return fg('text')
  }
}

export class PluginsPanel implements Component, Focusable {
  focused = false
  private offset = 0
  /** 当前高亮的条目行（扁平行序；分区头不可选中）。 */
  private selected = 0

  constructor(
    private readonly rows: readonly PluginsRow[],
    private readonly onClose: () => void,
    private readonly onPick: (action: string) => void,
  ) {
    // 初始高亮指向第一个条目（分区头不可选中）。
    const first = rows.findIndex(row => row.kind === 'item')
    this.selected = first === -1 ? 0 : first
  }

  /** 可选中条目的扁平序号。 */
  private itemIndexes(): number[] {
    return this.rows
      .map((row, index) => (row.kind === 'item' ? index : -1))
      .filter(index => index >= 0)
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape')) {
      this.onClose()
      return
    }
    const items = this.itemIndexes()
    if (items.length === 0) return
    const pos = items.indexOf(this.selected)
    if (matchesKey(data, 'down')) {
      this.selected = items[(pos + 1) % items.length]
      this.revealSelection()
      return
    }
    if (matchesKey(data, 'up')) {
      this.selected = items[(pos - 1 + items.length) % items.length]
      this.revealSelection()
      return
    }
    if (matchesKey(data, 'pageUp')) {
      this.offset = Math.max(0, this.offset - VISIBLE_ROWS)
      return
    }
    if (matchesKey(data, 'pageDown')) {
      this.offset = Math.min(Math.max(0, this.rows.length - VISIBLE_ROWS), this.offset + VISIBLE_ROWS)
      return
    }
    if (matchesKey(data, 'enter')) {
      const row = this.rows[this.selected]
      if (row.kind === 'item') this.onPick(row.action)
    }
  }

  private revealSelection(): void {
    if (this.selected < this.offset) this.offset = this.selected
    else if (this.selected >= this.offset + VISIBLE_ROWS) this.offset = this.selected - VISIBLE_ROWS + 1
  }

  invalidate(): void {
    // Pure render over rows/window offset.
  }

  render(width: number): string[] {
    const maxEnd = Math.max(0, this.rows.length - VISIBLE_ROWS)
    const start = Math.min(this.offset, maxEnd)
    const visible = this.rows.slice(start, start + VISIBLE_ROWS)
    const lines: string[] = [
      `${fg('accent')('▸')} ${bold(fg('text')(strings().pluginsTitle))}`,
      fg('borderMuted')('─'.repeat(Math.max(0, width))),
    ]
    if (start > 0) {
      lines.push(truncateToWidth(fg('dim')(`  ↑ 还有 ${start} 条`), width))
    }
    for (let i = 0; i < visible.length; i++) {
      const row = visible[i]
      const flat = start + i
      if (row.kind === 'header') {
        lines.push(truncateToWidth(` ${bold(fg('accent')(row.title))}`, width))
        continue
      }
      const body = `${truncateToWidth(row.label, Math.max(0, width - 40))}  ${toneFormatter(row.tone)(truncateToWidth(row.detail, 34))}`
      lines.push(truncateToWidth(flat === this.selected
        ? ` ❯ ${bold(fg('text')(body))}`
        : `   ${body}`, width))
    }
    const remaining = this.rows.length - (start + visible.length)
    if (remaining > 0) {
      lines.push(truncateToWidth(fg('dim')(`  ↓ 还有 ${remaining} 条`), width))
    }
    lines.push(truncateToWidth(fg('dim')(strings().pluginsHint), width))
    return lines
  }
}
