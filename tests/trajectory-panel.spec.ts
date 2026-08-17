/**
 * 轨迹面板（B11/H31）：事件行窗口化、按 seq/类型/摘要过滤、滚动窗口与关闭。
 */

import { describe, expect, it } from 'vitest'
import { TrajectoryPanel } from '../src/view/components/trajectory-panel.ts'
import type { TrajectoryRow } from '../src/app/terminal-app.ts'

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
}

function rows(count: number): TrajectoryRow[] {
  return Array.from({ length: count }, (_, i) => ({
    seq: i + 1,
    type: i % 2 === 0 ? 'user/message' : 'tool/call',
    at: 1_000 + i,
    summary: i % 2 === 0 ? `user line ${i}` : `bash ${i}`,
  }))
}

describe('trajectory panel', () => {
  it('renders the title with the total event count and seq/clock/type rows', () => {
    const panel = new TrajectoryPanel(rows(5), () => {})
    const lines = panel.render(100).map(stripAnsi)
    expect(lines.some(line => line.includes('轨迹'))).toBe(true)
    expect(lines.some(line => line.includes('5 条事件'))).toBe(true)
    expect(lines.some(line => line.includes('#01'))).toBe(true)
    expect(lines.some(line => line.includes('user/message'))).toBe(true)
    expect(lines.some(line => line.includes('tool/call'))).toBe(true)
    expect(lines.some(line => line.includes('bash 1'))).toBe(true)
  })

  it('filters rows by seq, type, and summary substring', () => {
    const panel = new TrajectoryPanel(rows(10), () => {})
    for (const character of 'tool') panel.handleInput(character)
    const lines = panel.render(100).map(stripAnsi)
    expect(lines.some(line => line.includes('tool/call'))).toBe(true)
    expect(lines.some(line => line.includes('user/message'))).toBe(false)
    // 标题仍显示总数（10 条事件），行列表只剩匹配项。
    expect(lines.some(line => line.includes('10 条事件'))).toBe(true)
    // seq 过滤同样生效。
    for (const character of '\x7f\x7f\x7f\x7f') panel.handleInput(character) // 清空
    for (const character of '3') panel.handleInput(character)
    const bySeq = panel.render(100).map(stripAnsi)
    expect(bySeq.some(line => line.includes('#03'))).toBe(true)
    expect(bySeq.some(line => line.includes('#01'))).toBe(false)
  })

  it('windows long lists and closes on escape', () => {
    let closed = 0
    const panel = new TrajectoryPanel(rows(40), () => { closed++ })
    const lines = panel.render(100).map(stripAnsi)
    expect(lines.some(line => line.includes('↓ 还有'))).toBe(true)
    panel.handleInput('\x1b[6~') // PgDn 翻页
    const paged = panel.render(100).map(stripAnsi)
    expect(paged.some(line => line.includes('↑ 还有'))).toBe(true)
    panel.handleInput('\x1b')
    expect(closed).toBe(1)
  })
})
