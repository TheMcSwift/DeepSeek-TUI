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
})
