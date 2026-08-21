/**
 * /settings 面板（M2）：行渲染、数字直选、Enter 执行、Esc 关闭、行就地刷新；
 * 面板只用语义色（随主题预设自动换肤），此处断言结构而非具体色值。
 */

import { describe, expect, it } from 'vitest'
import { SettingsPanel } from '../src/view/components/settings-panel.ts'
import type { SettingsRow } from '../src/app/terminal-app.ts'

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
}

function rows(): SettingsRow[] {
  return [
    { key: '语言', current: 'zh', target: '→ /lang' },
    { key: '主题', current: '暗色 · web', tone: 'accent', target: '→ /theme' },
    { key: 'Enter 行为', current: '排队（web 默认）', tone: 'info', target: '→ 切换' },
    { key: '快捷键预设', current: 'cc', tone: 'accent', target: '→ /keymap' },
    { key: '动画', current: '开', target: '→ 切换' },
    { key: '配置文件', current: '/tmp/settings.yaml', tone: 'muted', target: '→ /config' },
  ]
}

describe('settings panel', () => {
  it('renders the title, all rows and the hint', () => {
    const panel = new SettingsPanel(rows(), () => {}, () => {}, () => {})
    const lines = panel.render(100).map(stripAnsi)
    expect(lines.some(line => line.includes('设置'))).toBe(true)
    expect(lines.some(line => line.includes('语言'))).toBe(true)
    expect(lines.some(line => line.includes('主题'))).toBe(true)
    expect(lines.some(line => line.includes('快捷键预设'))).toBe(true)
    expect(lines.some(line => line.includes('/tmp/settings.yaml'))).toBe(true)
    expect(lines.some(line => line.includes('Esc 关闭'))).toBe(true)
  })

  it('picks rows by number and by Enter, closes on escape', () => {
    const picked: number[] = []
    let closed = 0
    const panel = new SettingsPanel(rows(), () => { closed++ }, (index) => { picked.push(index) }, () => {})
    panel.handleInput('3')
    expect(picked).toEqual([2]) // 数字直选（1 基）
    panel.handleInput('\r')
    expect(picked).toEqual([2, 2]) // Enter 执行当前选中行
    panel.handleInput('9') // 越界行：忽略
    expect(picked).toEqual([2, 2])
    panel.handleInput('\x1b')
    expect(closed).toBe(1)
  })

  it('refreshes rows in place', () => {
    const panel = new SettingsPanel(rows(), () => {}, () => {}, () => {})
    panel.setRows([{ key: '语言', current: 'en', target: '→ /lang' }])
    const lines = panel.render(100).map(stripAnsi)
    expect(lines.some(line => line.includes('en'))).toBe(true)
    expect(lines.some(line => line.includes('主题'))).toBe(false)
  })

  it('scrolls with the cursor and windows long lists', () => {
    const many = Array.from({ length: 24 }, (_, i): SettingsRow => ({ key: `行${i}`, current: String(i), target: '→ x' }))
    const panel = new SettingsPanel(many, () => {}, () => {}, () => {})
    for (let i = 0; i < 12; i++) panel.handleInput('\x1b[B') // 12 × ↓
    const lines = panel.render(100).map(stripAnsi)
    expect(lines.some(line => line.includes('↑ 还有'))).toBe(true)
    expect(lines.some(line => line.includes('行11'))).toBe(true)
    expect(lines.some(line => line.includes('行0'))).toBe(false)
  })

  it('wraps arrows around the list ends and pages the selection with PgUp/PgDn', () => {
    const many = Array.from({ length: 24 }, (_, i): SettingsRow => ({ key: `行${i}`, current: String(i), target: '→ x' }))
    const panel = new SettingsPanel(many, () => {}, () => {}, () => {})
    panel.handleInput('\x1b[A') // ↑ 首部 → 尾部
    expect(panel.selectedIndex).toBe(23)
    panel.handleInput('\x1b[B') // ↓ 尾部 → 首部
    expect(panel.selectedIndex).toBe(0)
    panel.handleInput('\x1b[6~') // PgDn → +10
    expect(panel.selectedIndex).toBe(10)
    panel.handleInput('\x1b[6~') // → 20
    expect(panel.selectedIndex).toBe(20)
    panel.handleInput('\x1b[6~') // 越界钳制
    expect(panel.selectedIndex).toBe(23)
    panel.handleInput('\x1b[5~') // PgUp → 13
    expect(panel.selectedIndex).toBe(13)
    // 翻页后选中行仍在窗口内可见（窗口跟随选中）。
    const lines = panel.render(100).map(stripAnsi)
    expect(lines.some(line => line.includes('行13'))).toBe(true)
  })

  it('cycles values inline with ←/→ on cycle rows only (cc 语式)', () => {
    const cycled: Array<[number, 1 | -1]> = []
    const panel = new SettingsPanel([
      { key: '语言', current: 'zh', target: '→ /lang', cycle: { options: ['zh', 'en'], current: 'zh' } },
      { key: '主题', current: 'web', tone: 'accent', target: '→ /theme', cycle: { options: ['web', 'cc'], current: 'web' } },
      { key: '配置文件', current: '/tmp/settings.yaml', target: '→ /config' },
    ], () => {}, () => {}, (index, direction) => { cycled.push([index, direction]) })
    panel.handleInput('\x1b[C') // → on 语言行
    expect(cycled).toEqual([[0, 1]])
    panel.handleInput('\x1b[D') // ← on 语言行
    expect(cycled).toEqual([[0, 1], [0, -1]])
    panel.handleInput('\x1b[B') // ↓ 到主题行
    panel.handleInput('\x1b[C')
    expect(cycled).toEqual([[0, 1], [0, -1], [1, 1]])
    panel.handleInput('\x1b[B') // ↓ 到配置文件行（无 cycle）
    panel.handleInput('\x1b[C') // → 被忽略
    expect(cycled).toEqual([[0, 1], [0, -1], [1, 1]])
    // 可循环行目标列显示 ←/→，提示行补行内切换说明。
    const lines = panel.render(100).map(stripAnsi)
    expect(lines.some(line => line.includes('←/→'))).toBe(true)
    expect(lines.some(line => line.includes('←/→ 切换值'))).toBe(true)
  })
})
