/**
 * /plugins 能力清单面板（M3）：分区头 + 条目渲染、↑/↓ + Enter 选中、
 * Esc 关闭、窗口滚动。
 */

import { describe, expect, it } from 'vitest'
import { PluginsPanel } from '../src/view/components/plugins-panel.ts'
import type { PluginsRow } from '../src/app/terminal-app.ts'

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
}

function rows(): PluginsRow[] {
  return [
    { kind: 'header', title: '命令 (2)' },
    { kind: 'item', action: 'command:goal', label: '/goal', detail: 'Set the session goal' },
    { kind: 'item', action: 'command:compact', label: '/compact', detail: 'Compact the transcript' },
    { kind: 'header', title: '技能 (1)' },
    { kind: 'item', action: 'skill:audit', label: '/audit', detail: '选中插入输入框' },
    { kind: 'header', title: '投影 (2)' },
    { kind: 'item', action: 'projection:permissions', label: 'permissions', detail: 'workspace-write', tone: 'accent' },
    { kind: 'item', action: 'projection:contextBreakdown', label: 'contextBreakdown', detail: '结构化投影（无枚举）', tone: 'muted' },
  ]
}

describe('plugins panel', () => {
  it('renders section headers and item rows', () => {
    const panel = new PluginsPanel(rows(), () => {}, () => {})
    const lines = panel.render(100).map(stripAnsi)
    expect(lines.some(line => line.includes('插件与能力'))).toBe(true)
    expect(lines.some(line => line.includes('命令 (2)'))).toBe(true)
    expect(lines.some(line => line.includes('/goal'))).toBe(true)
    expect(lines.some(line => line.includes('技能 (1)'))).toBe(true)
    expect(lines.some(line => line.includes('投影 (2)'))).toBe(true)
    expect(lines.some(line => line.includes('contextBreakdown'))).toBe(true)
  })

  it('navigates items with arrows (skipping headers) and picks with Enter', () => {
    const picked: string[] = []
    let closed = 0
    const panel = new PluginsPanel(rows(), () => { closed++ }, (action) => { picked.push(action) })
    panel.handleInput('\r') // 首个条目：/goal
    expect(picked).toEqual(['command:goal'])
    panel.handleInput('\x1b[B') // ↓ → /compact
    panel.handleInput('\r')
    expect(picked).toEqual(['command:goal', 'command:compact'])
    panel.handleInput('\x1b[B') // ↓ → skill:audit（跳过技能分区头）
    panel.handleInput('\x1b[B') // ↓ → projection:permissions
    panel.handleInput('\r')
    expect(picked).toEqual(['command:goal', 'command:compact', 'projection:permissions'])
    panel.handleInput('\x1b')
    expect(closed).toBe(1)
  })

  it('windows long lists', () => {
    const many: PluginsRow[] = Array.from({ length: 30 }, (_, i): PluginsRow => ({ kind: 'item', action: `command:c${i}`, label: `/c${i}`, detail: 'x' }))
    const panel = new PluginsPanel(many, () => {}, () => {})
    panel.handleInput('\x1b[6~') // PgDn
    const lines = panel.render(100).map(stripAnsi)
    expect(lines.some(line => line.includes('↑ 还有'))).toBe(true)
    expect(lines.some(line => line.includes('↓ 还有'))).toBe(true)
  })
})
