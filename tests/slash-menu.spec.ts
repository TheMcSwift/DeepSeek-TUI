/**
 * SlashMenu 三种语式（广义交互层 slash 维度）：cc `plain` 无边框行、pi
 * `boxed` 圆角框、opencode `popup` 方角弹层（标题计数行 + 整行选中 + 描述列
 * + Ctrl+P 面板入口）。`panel` 语式不构造本组件，故不在此覆盖。
 */

import { describe, expect, it } from 'vitest'
import { visibleWidth } from '@earendil-works/pi-tui'
import { SlashMenu } from '../src/view/components/slash-menu.ts'
import type { SlashMenuItem } from '../src/view/components/slash-menu.ts'

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
}

const ITEMS: SlashMenuItem[] = [
  { name: 'new', hint: '· 新会话', description: '开一个新会话' },
  { name: 'model', description: '切换模型' },
  { name: 'quit', description: '退出' },
]

describe('SlashMenu popup 语式（opencode）', () => {
  it('渲染方角边框、标题计数行、描述列与命令面板入口', () => {
    const lines = new SlashMenu(ITEMS, 'popup').render(60).map(stripAnsi)
    const joined = lines.join('\n')
    expect(lines[0]).toContain('┌')
    expect(lines[0]).toContain('命令 · 3 项')
    expect(lines.at(-1)).toContain('└')
    expect(lines.at(-1)).toContain('┘')
    expect(joined).not.toContain('╭') // 圆角是 pi 的语式
    expect(joined).toContain('/new · 新会话')
    expect(joined).toContain('开一个新会话') // 描述列（compact 语式才省略）
    expect(joined).toContain('Ctrl+P 面板')
    expect(joined).toContain('PgUp/PgDn 翻页')
  })

  it('选中行铺满内宽（整行高亮），且每行等宽', () => {
    const menu = new SlashMenu(ITEMS, 'popup')
    menu.selectedIndex = 1
    const lines = menu.render(60).map(stripAnsi)
    const widths = new Set(lines.map(line => visibleWidth(line)))
    expect(widths.size).toBe(1) // 边框、内容、选中行全部等宽
    const selected = lines.find(line => line.includes('❯'))
    expect(selected).toContain('/model')
    // 选中行内容右侧补满空格（高亮铺满而不是只包住文字）。
    expect(selected?.endsWith(' │')).toBe(true)
  })

  it('无匹配时仍保留边框与空态文案', () => {
    const lines = new SlashMenu([], 'popup').render(60).map(stripAnsi)
    expect(lines[0]).toContain('命令 · 0 项')
    expect(lines.join('\n')).toContain('无匹配命令')
    expect(lines.at(-1)).toContain('┘')
  })
})

describe('SlashMenu cc/pi 语式回归', () => {
  it('plain（cc）无边框，boxed（pi）圆角框', () => {
    const plain = new SlashMenu(ITEMS, 'plain').render(60).map(stripAnsi).join('\n')
    expect(plain).not.toContain('┌')
    expect(plain).not.toContain('╭')
    expect(plain).toContain('/new · 新会话')
    expect(plain).not.toContain('Ctrl+P 面板') // 面板入口只属于 popup

    const boxed = new SlashMenu(ITEMS, 'boxed').render(60).map(stripAnsi)
    expect(boxed[0]).toContain('╭')
    expect(boxed.at(-1)).toContain('╯')
    expect(boxed.join('\n')).not.toContain('┌')
    // 圆角框行同样补满内宽：右边框与四角对齐（顺带修复的既有视觉缺陷）。
    expect(new Set(boxed.map(line => visibleWidth(line))).size).toBe(1)
  })
})
