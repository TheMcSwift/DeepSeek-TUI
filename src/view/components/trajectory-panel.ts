/**
 * 轨迹视图（B11/H31，web ui-trajectory 的终端对应）：把当前会话的原始事件
 * 日志（seq 升序）窗口化成可过滤、可滚动的 overlay——事件类型分色、时间戳
 * 与单行摘要，用于长任务的排查（哪个工具卡住、事件顺序、轮次边界）。
 * 数据来自 runner 的 session.events（sessionQuery.listEvents 的 live 等价），
 * 面板只做瞬态派生渲染，不落文档。
 * @module dsh-tui-app/view/components/trajectory-panel
 */

import { matchesKey, truncateToWidth } from '@earendil-works/pi-tui'
import type { Component, Focusable } from '@earendil-works/pi-tui'
import { bold, fg } from '../../app/pi/color.ts'
import { matchTraceQuery } from '../../control/summaries.ts'
import type { TrajectoryRow } from '../../app/terminal-app.ts'
import { strings } from '../strings.ts'

/** Rows visible in the panel window at once (the overlay clips the rest). */
const VISIBLE_ROWS = 12

/** 事件类型 → 色相：一眼分辨消息/工具/助手/轮次/审批。 */
function typeTone(type: string): (text: string) => string {
  if (type.startsWith('tool')) return fg('accent')
  if (type.startsWith('assistant')) return fg('info')
  if (type.startsWith('user')) return fg('text')
  if (type.startsWith('approval')) return fg('warning')
  if (type.startsWith('turn') || type.startsWith('step')) return fg('dim')
  return fg('muted')
}

/** HH:MM:SS clock for a log row. */
function rowClock(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export class TrajectoryPanel implements Component, Focusable {
  focused = false
  private offset = 0
  private query = ''

  constructor(
    private readonly rows: readonly TrajectoryRow[],
    private readonly onClose: () => void,
  ) {}

  private filtered(): TrajectoryRow[] {
    if (this.query === '') return [...this.rows]
    return this.rows.filter(row => matchTraceQuery(this.query, row))
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape')) {
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
      return
    }
    // A13: `[`/`]` 跳错误行、`{`/`}` 跳轮次边界（方向 -1 向前 / +1 向后）。
    if (data === '[') {
      this.jumpTo('error', -1)
      return
    }
    if (data === ']') {
      this.jumpTo('error', 1)
      return
    }
    if (data === '{') {
      this.jumpTo('turn', -1)
      return
    }
    if (data === '}') {
      this.jumpTo('turn', 1)
      return
    }
    if (matchesKey(data, 'backspace')) {
      this.query = this.query.slice(0, -1)
      this.offset = 0
      return
    }
    // 可打印字符进过滤串（Ctrl 组合与修饰键不进）。
    if (data.length === 1 && data >= ' ' && !matchesKey(data, 'enter')) {
      this.query += data.toLowerCase()
      this.offset = 0
    }
  }

  private scrollBy(delta: number): void {
    this.offset = Math.min(
      Math.max(0, this.offset + delta),
      Math.max(0, this.filtered().length - VISIBLE_ROWS),
    )
  }

  /** A13: 跳转到前/后一个错误行（[ ]）或轮次边界（{ }）。 */
  private jumpTo(kind: 'error' | 'turn', direction: 1 | -1): void {
    const rows = this.filtered()
    if (rows.length === 0) return
    const isTarget = (row: TrajectoryRow): boolean => {
      if (kind === 'turn') return row.type === 'turn/start'
      const lower = row.summary.toLowerCase()
      return row.summary.includes('✗') || lower.includes('失败') || lower.includes('error')
    }
    let i = this.offset
    for (let step = 0; step < rows.length; step++) {
      i = (i + direction + rows.length) % rows.length
      if (isTarget(rows[i])) {
        this.offset = Math.min(i, Math.max(0, rows.length - VISIBLE_ROWS))
        return
      }
    }
  }

  invalidate(): void {
    // Pure render over rows/query/window offset.
  }

  render(width: number): string[] {
    const rows = this.filtered()
    const seqWidth = Math.max(2, String(this.rows.length).length)
    const maxEnd = Math.max(0, rows.length - VISIBLE_ROWS)
    const start = Math.min(this.offset, maxEnd)
    const visible = rows.slice(start, start + VISIBLE_ROWS)
    const lines: string[] = [
      `${fg('accent')('▸')} ${bold(fg('text')(strings().trajectoryTitle))} · ${fg('muted')(strings().trajectoryEvents(this.rows.length))}`,
      fg('borderMuted')('─'.repeat(Math.max(0, width))),
      ` ${fg('accent')('🔍')} ${this.query === '' ? fg('dim')('输入过滤…') : fg('text')(this.query)}`,
    ]
    if (start > 0) {
      lines.push(truncateToWidth(fg('dim')(`  ↑ 还有 ${start} 条`), width))
    }
    for (const row of visible) {
      const no = String(row.seq).padStart(seqWidth, '0')
      const summary = row.summary === '' ? '' : ` ${fg('muted')(truncateToWidth(row.summary, Math.max(0, width - seqWidth - 22)))}`
      lines.push(truncateToWidth(
        `${fg('dim')(`#${no}`)} ${fg('dim')(rowClock(row.at))} ${typeTone(row.type)(truncateToWidth(row.type, 18))}${summary}`,
        width,
      ))
    }
    const remaining = rows.length - (start + visible.length)
    if (remaining > 0) {
      lines.push(truncateToWidth(fg('dim')(`  ↓ 还有 ${remaining} 条`), width))
    }
    lines.push(truncateToWidth(fg('dim')(strings().trajectoryFilterHint), width))
    return lines
  }
}
