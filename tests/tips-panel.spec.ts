/**
 * The /tips reference panel (A18): grouped free-form hint lines, windowed
 * scrolling, and the standard close keys. Rendered headlessly.
 */

import { describe, expect, it } from 'vitest'
import { TipsPanel } from '../src/view/components/tips-panel.ts'
import type { TipGroup } from '../src/view/strings.ts'

const strip = (line: string): string => line.replace(/\x1b\[[0-9;]*m/g, '')

const groups: TipGroup[] = [
  { title: '快捷键', lines: ['Esc 中断', 'Ctrl+Enter 打断发送'] },
  { title: '避坑', lines: ['Shift+Enter 换行'] },
]

describe('tips panel (A18)', () => {
  it('renders group headers and every tip line', () => {
    const panel = new TipsPanel(groups, () => {})
    const lines = panel.render(60).map(strip)
    expect(lines[0]).toContain('使用提示')
    const text = lines.join('\n')
    expect(text).toContain('快捷键')
    expect(text).toContain('Esc 中断')
    expect(text).toContain('Ctrl+Enter 打断发送')
    expect(text).toContain('避坑')
  })

  it('windows long lists and closes on Esc/Enter/q', () => {
    const many: TipGroup[] = [
      { title: '全部', lines: Array.from({ length: 20 }, (_, index) => `提示 ${index}`) },
    ]
    const panel = new TipsPanel(many, () => {})
    const first = panel.render(60).map(strip)
    expect(first.join('\n')).toContain('↓ 还有')
    let closed = 0
    const closable = new TipsPanel(groups, () => { closed += 1 })
    closable.handleInput('\x1b')
    closable.handleInput('\r')
    closable.handleInput('q')
    expect(closed).toBe(3)
  })
})
