/**
 * DecisionCard 命令块回归（CC-02）：权限审批弹窗在 reason 与选项之间渲染
 * 待审批的命令原文（高亮）与影响文件行——Claude Code 权限弹窗的核心信息面。
 */

import { describe, expect, it } from 'vitest'
import { DecisionCard } from '../src/view/components/decision-card.ts'

describe('DecisionCard command block', () => {
  it('renders the command and impact lines between detail and options (CC-02)', () => {
    const card = new DecisionCard(
      'Approve tool call: bash?',
      ['runs rm'],
      ['Allow once', 'Reject'],
      undefined,
      undefined,
      '⚠',
      false,
      undefined,
      undefined,
      [],
      'rm -rf /tmp/x',
      ['将修改：/tmp/x'],
    )
    const joined = card.render(60).join('\n')
    expect(joined).toContain('命令')
    expect(joined).toContain('rm -rf /tmp/x')
    expect(joined).toContain('将修改：/tmp/x')
    // 命令块出现在选项之前，紧跟原因之后。
    expect(joined.indexOf('runs rm')).toBeLessThan(joined.indexOf('rm -rf /tmp/x'))
    expect(joined.indexOf('rm -rf /tmp/x')).toBeLessThan(joined.indexOf('1. Allow once'))
  })

  it('omits the command block entirely when nothing was provided', () => {
    const card = new DecisionCard('question?', [], ['yes', 'no'], undefined, undefined, '？', false, undefined, undefined, [])
    const joined = card.render(60).join('\n')
    expect(joined).not.toContain('命令')
    expect(joined).toContain('1. yes')
  })

  it('renders the plan-review feedback row and navigates to it (B11)', () => {
    const card = new DecisionCard(
      'Approve the plan?', ['plan markdown'], ['批准', '继续规划'], undefined,
      '批准', '？', false, undefined, undefined, [], undefined, undefined, 'boxed', true,
    )
    // 反馈行是选项后的可选中行；空态提示文案可见。
    expect(card.entryCount).toBe(3)
    expect(card.feedbackIndex).toBe(2)
    const joined = card.render(60).join('\n')
    expect(joined).toContain('反馈（直接打字进入）')
    // ↑/↓ 移动到反馈行并打字：缓冲追加、选中移到反馈行、错误提示清除。
    card.moveSelection(2)
    expect(card.onFeedback).toBe(true)
    card.typeFeedback('改用 C 方案')
    card.typeFeedback('！')
    expect(card.feedback).toBe('改用 C 方案！')
    expect(card.onFeedback).toBe(true)
    expect(card.render(60).join('\n')).toContain('反馈：改用 C 方案！')
    card.backspaceFeedback()
    expect(card.feedback).toBe('改用 C 方案')
    // 批准带反馈的错误提示渲染。
    card.setErrorHint('批准不能附带反馈')
    expect(card.render(60).join('\n')).toContain('批准不能附带反馈')
  })

  it('renders the plain (cc) form: borderless, numbered options, ▸ title (广义交互层)', () => {
    const card = new DecisionCard(
      'Approve tool call: bash?',
      ['runs rm'],
      ['Allow once', 'Reject'],
      undefined,
      undefined,
      '⚠',
      false,
      undefined,
      undefined,
      [],
      'rm -rf /tmp/x',
      undefined,
      'plain',
    )
    const joined = card.render(60).join('\n')
    for (const borderChar of ['╭', '│', '╮', '╰', '╯']) {
      expect(joined).not.toContain(borderChar)
    }
    const plain = joined.replace(/\x1b\[[0-9;]*m/g, '')
    expect(plain).toContain('▸ ⚠ Approve tool call: bash?')
    expect(plain).toContain('1. Allow once')
    expect(plain).toContain('2. Reject')
    // 命令块与提示在 plain 形态下同样渲染。
    expect(plain).toContain('命令')
    expect(plain).toContain('rm -rf /tmp/x')
    expect(plain).toContain('Esc 取消')
  })
})

describe('DecisionCard list navigation', () => {
  it('wraps the selection around the option+footer list (↑/↓)', () => {
    const card = new DecisionCard('q', [], ['a', 'b', 'c'], undefined, undefined, '？', false, undefined, undefined, [])
    card.moveSelection(-1) // ↑ 首部 → 尾部
    expect(card.selectedIndex).toBe(2)
    card.moveSelection(1) // ↓ 尾部 → 首部
    expect(card.selectedIndex).toBe(0)
    card.moveSelection(1)
    card.moveSelection(1)
    expect(card.selectedIndex).toBe(2)
  })

  it('wraps through footer entries as part of the list', () => {
    const card = new DecisionCard('q', [], ['a', 'b'], undefined, undefined, '？', false, undefined, undefined, ['跳过本题'])
    expect(card.entryCount).toBe(3)
    card.moveSelection(-1) // ↑ 首部 → 最后一个 footer 条目
    expect(card.selectedIndex).toBe(2)
    card.moveSelection(1) // ↓ footer 尾部 → 首部选项
    expect(card.selectedIndex).toBe(0)
  })

  it('pages the selection by the option window (PgUp/PgDn), clamped at the ends', () => {
    const card = new DecisionCard('q', [], Array.from({ length: 20 }, (_, i) => `o${i}`), undefined, undefined, '？', false, undefined, undefined, [])
    card.page(1)
    expect(card.selectedIndex).toBe(6)
    card.page(1)
    expect(card.selectedIndex).toBe(12)
    card.page(1)
    expect(card.selectedIndex).toBe(18) // 越界钳制
    card.page(-1)
    expect(card.selectedIndex).toBe(12)
    card.page(-5)
    expect(card.selectedIndex).toBe(0) // 顶部钳制
  })

  it('windows long option lists so the selection stays visible', () => {
    const card = new DecisionCard('q', [], Array.from({ length: 20 }, (_, i) => `o${i}`), undefined, undefined, '？', false, undefined, undefined, [])
    card.moveSelection(8)
    const lines = card.render(60).join('\n').replace(/\x1b\[[0-9;]*m/g, '')
    expect(lines).toContain('↑ 还有')
    expect(lines).toContain('↓ 还有')
    expect(lines).toContain('9. o8') // 选中行在窗口内
    expect(lines).not.toContain('1. o0') // 窗口外的头部被折叠
    // 连按两次 PgDn 到尾（钳制在 19），窗口跟随滚动，最后的选项可见。
    card.page(1)
    card.page(1)
    const tail = card.render(60).join('\n').replace(/\x1b\[[0-9;]*m/g, '')
    expect(tail).toContain('20. o19')
  })
})
