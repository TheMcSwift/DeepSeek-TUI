/**
 * 过滤选择器面板：onActivity 键击上报（含方向键）——runner 据此暂停
 * 空闲标题回填，保证导航流畅；顺带覆盖 Esc 取消与 Enter 选中路径。
 */

import { describe, expect, it } from 'vitest'
import { FilterablePickerPanel } from '../src/view/components/filterable-picker.ts'

describe('filterable picker', () => {
  it('reports every keystroke including arrows via onActivity', () => {
    let activity = 0
    const picked: Array<string | null> = []
    const panel = new FilterablePickerPanel(
      '会话切换',
      [{ value: 'a', label: '行 A' }, { value: 'b', label: '行 B' }],
      (value) => { picked.push(value) },
      undefined,
      () => { activity++ },
    )
    panel.handleInput('\x1b[B') // ↓ 导航
    panel.handleInput('a') // 过滤输入（行 A 命中）
    panel.handleInput('\r') // Enter 选中
    expect(activity).toBe(3)
    expect(picked).toEqual(['a'])
    panel.handleInput('\x1b') // Esc 取消
    expect(activity).toBe(4)
    expect(picked).toEqual(['a', null])
  })

  it('works without the activity hook (other pickers do not pass it)', () => {
    const panel = new FilterablePickerPanel('模型', [{ value: 'm', label: 'model' }], () => {})
    panel.handleInput('\x1b[B')
    expect(panel.render(60).join('\n')).toContain('model')
  })

  it('pages the selection with PgUp/PgDn by the window size', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ value: `v${i}`, label: `行 ${i}` }))
    const picked: Array<string | null> = []
    const panel = new FilterablePickerPanel('长列表', rows, (value) => { picked.push(value) })
    // SelectList 的滚动信息行显示 (选中+1/总数)；初态 (1/25)。
    expect(panel.render(60).join('\n')).toContain('(1/25)')
    panel.handleInput('\x1b[6~') // PgDn → 第 11 行
    expect(panel.render(60).join('\n')).toContain('(11/25)')
    panel.handleInput('\x1b[5~') // PgUp → 回到首行
    expect(panel.render(60).join('\n')).toContain('(1/25)')
    panel.handleInput('\x1b[6~')
    panel.handleInput('\x1b[6~')
    panel.handleInput('\x1b[6~') // 尾部钳制
    expect(panel.render(60).join('\n')).toContain('(25/25)')
    panel.handleInput('\r')
    expect(picked).toEqual(['v24'])
  })
})
