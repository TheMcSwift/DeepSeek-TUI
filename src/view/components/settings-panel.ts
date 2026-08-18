/**
 * /settings 聚合面板（M2）：一行一设置，现状值 + 操作提示，窗口滚动 +
 * 数字直选 + Enter 执行。**视觉完全调色板驱动**——只用语义色名
 * （accent/muted/dim/borderMuted/selectedBg），零硬编码 hex，因此随
 * 当前主题预设（web/cc/pi/opencode）自动呈现对应风格，面板内切主题后
 * 就地重绘新风格。
 * @module dsh-tui-app/view/components/settings-panel
 */

import { matchesKey, truncateToWidth, visibleWidth } from '@earendil-works/pi-tui'
import type { Component, Focusable } from '@earendil-works/pi-tui'
import { bold, bg, fg } from '../../app/pi/color.ts'
import type { SettingsRow } from '../../app/terminal-app.ts'
import { strings } from '../strings.ts'

/** Rows visible in the panel window at once (the overlay clips the rest). */
const VISIBLE_ROWS = 10

/** 现状值语义色调 → formatter（只用语义名，随预设换色）。 */
function toneFormatter(tone: SettingsRow['tone']): (text: string) => string {
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

/** Pad to a target DISPLAY width (CJK counts double). */
function padTo(text: string, target: number): string {
  return text + ' '.repeat(Math.max(0, target - visibleWidth(text)))
}

export class SettingsPanel implements Component, Focusable {
  focused = false
  selectedIndex = 0
  private offset = 0

  constructor(
    private rows: readonly SettingsRow[],
    private readonly onClose: () => void,
    private readonly onPick: (index: number) => void,
  ) {}

  /** 行变化后就地刷新（如面板内切换主题后重新收集的现状值）。 */
  setRows(rows: readonly SettingsRow[]): void {
    this.rows = rows
    this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, rows.length - 1))
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape')) {
      this.onClose()
      return
    }
    // 数字直选：行序 1..9（DecisionCard 同惯例）。
    if (data.length === 1 && data >= '1' && data <= '9') {
      const index = Number(data) - 1
      if (index < this.rows.length) {
        this.selectedIndex = index
        this.onPick(index)
      }
      return
    }
    if (matchesKey(data, 'up')) {
      this.selectedIndex = Math.max(0, this.selectedIndex - 1)
      this.revealSelection()
      return
    }
    if (matchesKey(data, 'down')) {
      this.selectedIndex = Math.min(this.rows.length - 1, this.selectedIndex + 1)
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
      this.onPick(this.selectedIndex)
    }
  }

  private revealSelection(): void {
    if (this.selectedIndex < this.offset) this.offset = this.selectedIndex
    else if (this.selectedIndex >= this.offset + VISIBLE_ROWS) this.offset = this.selectedIndex - VISIBLE_ROWS + 1
  }

  invalidate(): void {
    // Pure render over rows/window offset.
  }

  render(width: number): string[] {
    const keyWidth = this.rows.reduce((max, row) => Math.max(max, visibleWidth(row.key)), 0)
    const maxEnd = Math.max(0, this.rows.length - VISIBLE_ROWS)
    const start = Math.min(this.offset, maxEnd)
    const visible = this.rows.slice(start, start + VISIBLE_ROWS)
    const lines: string[] = [
      `${fg('accent')('▸')} ${bold(fg('text')(strings().settingsTitle))}`,
      fg('borderMuted')('─'.repeat(Math.max(0, width))),
    ]
    if (start > 0) {
      lines.push(truncateToWidth(fg('dim')(`  ↑ 还有 ${start} 条`), width))
    }
    for (let i = 0; i < visible.length; i++) {
      const row = visible[i]
      const index = start + i
      const valueWidth = Math.max(0, width - keyWidth - 18)
      const body = `${padTo(row.key, keyWidth)}  ${toneFormatter(row.tone)(truncateToWidth(row.current, valueWidth))}`
      const target = truncateToWidth(row.target, 14)
      const line = index === this.selectedIndex
        ? ` ${bg('selectedBg')(bold(fg('accent')(`❯ ${body}`)))}  ${fg('dim')(target)}`
        : `   ${body}  ${fg('dim')(target)}`
      lines.push(truncateToWidth(line, width))
    }
    const remaining = this.rows.length - (start + visible.length)
    if (remaining > 0) {
      lines.push(truncateToWidth(fg('dim')(`  ↓ 还有 ${remaining} 条`), width))
    }
    lines.push(truncateToWidth(fg('dim')(strings().settingsHint), width))
    return lines
  }
}
