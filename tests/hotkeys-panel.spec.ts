/**
 * The /hotkeys reference panel (G38 re-layout): grouped sections, one binding
 * per row, display-width-aligned action column, and a scrolled window over
 * long lists. Rendered headlessly — no terminal involved.
 */

import { describe, expect, it } from 'vitest'
import { HotkeysPanel } from '../src/view/components/hotkeys-panel.ts'
import type { HotkeySection } from '../src/view/strings.ts'

/** Strip SGR sequences so column math sees the visible text. */
const strip = (line: string): string => line.replace(/\x1b\[[0-9;]*m/g, '')

const sections: HotkeySection[] = [
  {
    title: '输入',
    rows: [
      { keys: 'Enter', action: '发送消息' },
      { keys: 'Ctrl+Shift+Z', action: '重做' },
    ],
  },
  {
    title: '会话与模型',
    rows: [
      { keys: 'Ctrl+G', action: '选择模型' },
      { keys: 'Ctrl+R', action: '会话列表' },
    ],
  },
]

describe('hotkeys panel (G38 re-layout)', () => {
  it('renders section headers and aligns every action to one column', () => {
    const panel = new HotkeysPanel(sections, () => {})
    const lines = panel.render(60).map(strip)
    expect(lines[0]).toContain('快捷键')
    const text = lines.join('\n')
    expect(text).toContain('输入')
    expect(text).toContain('会话与模型')
    expect(text).toContain('发送消息')
    // The key column takes the widest binding (Ctrl+Shift+Z), so the shorter
    // Ctrl+G/Ctrl+R rows pad their keys and every action starts at the same
    // column instead of jamming against the key.
    const redo = lines.find(line => line.includes('重做'))
    const model = lines.find(line => line.includes('选择模型'))
    const sessions = lines.find(line => line.includes('会话列表'))
    expect(redo).toBeDefined()
    expect(model).toBeDefined()
    expect(sessions).toBeDefined()
    expect(model!.indexOf('选择模型')).toBe(redo!.indexOf('重做'))
    expect(sessions!.indexOf('会话列表')).toBe(redo!.indexOf('重做'))
  })

  it('windows long lists and reports the hidden rows on both ends', () => {
    const many: HotkeySection[] = [
      { title: '全部', rows: Array.from({ length: 20 }, (_, index) => ({ keys: `Ctrl+${index}`, action: `动作 ${index}` })) },
    ]
    const panel = new HotkeysPanel(many, () => {})
    // 21 flattened rows, 10 visible → 11 hidden below, none above.
    const first = panel.render(50).map(strip).join('\n')
    expect(first).toContain('动作 0')
    expect(first).not.toContain('动作 19')
    expect(first).toContain('↓ 还有 11 条')
    expect(first).not.toContain('↑ 还有')
    // Scrolling reveals later rows and the above-count marker.
    for (let i = 0; i < 6; i++) panel.handleInput('\x1b[B')
    const scrolled = panel.render(50).map(strip).join('\n')
    expect(scrolled).toContain('动作 5')
    expect(scrolled).toContain('↑ 还有 6 条')
    expect(scrolled).not.toContain('动作 19')
    // Over-scrolling clamps to the last page; scrolling back up clamps to 0.
    for (let i = 0; i < 99; i++) panel.handleInput('\x1b[B')
    const end = panel.render(50).map(strip).join('\n')
    expect(end).toContain('动作 19')
    for (let i = 0; i < 99; i++) panel.handleInput('\x1b[A')
    const top = panel.render(50).map(strip).join('\n')
    expect(top).toContain('动作 0')
    expect(top).not.toContain('↑ 还有')
  })

  it('closes on Esc, Enter, and q through the focused handler', () => {
    let closed = 0
    const panel = new HotkeysPanel(sections, () => { closed++ })
    panel.handleInput('\x1b')
    panel.handleInput('\r')
    panel.handleInput('q')
    expect(closed).toBe(3)
    // Other keys (plain text) are ignored.
    panel.handleInput('x')
    panel.handleInput('\x1b[5~') // pageUp moves the window, not a close
    expect(closed).toBe(3)
  })
})
