/**
 * Capability panel rendering: goal/todo/jobs plus the workflow run block
 * (E15/H32: run row + member rows with outcome markers and phase labels).
 */

import { describe, expect, it } from 'vitest'
import { CapabilityPanel } from '../src/view/components/panels.ts'

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
}

describe('capability panel', () => {
  it('renders the workflow run block with member states and phases', () => {
    const panel = new CapabilityPanel()
    panel.set(undefined, undefined, [], {
      runs: [{
        runId: 'run-1', name: 'audit sweep', state: 'error',
        members: [
          { seq: 0, label: 'agent A', phase: 'scan', childId: 's-a', outcome: 'completed' },
          { seq: 1, label: 'agent B', childId: 's-b', outcome: 'failed' },
          { seq: 2, label: 'agent C', childId: 's-c' },
        ],
      }],
    })
    const lines = panel.render(100).map(stripAnsi)
    expect(lines[0]).toContain('◆ workflow')
    expect(lines[0]).toContain('audit sweep')
    expect(lines[0]).toContain('✓2/3')
    expect(lines[0]).toContain('1 ⟳') // one running member
    expect(lines[1]).toContain('agent A')
    expect(lines[1]).toContain('scan')
    expect(lines[2]).toContain('agent B')
    expect(lines[3]).toContain('agent C')
  })

  it('folds long member lists and keeps the run row first', () => {
    const panel = new CapabilityPanel()
    panel.set(undefined, undefined, [], {
      runs: [{
        runId: 'run-1', name: 'big', state: 'completed',
        members: Array.from({ length: 10 }, (_, i) => ({
          seq: i, label: `m${i}`, childId: `s-${i}`, outcome: 'completed' as const,
        })),
      }],
    })
    const lines = panel.render(100).map(stripAnsi)
    expect(lines[0]).toContain('◆ workflow')
    // 8 member rows plus the fold note.
    expect(lines.filter(line => line.includes('  ✓ m'))).toHaveLength(8)
    expect(lines.some(line => line.includes('还有 2 名成员'))).toBe(true)
  })

  it('renders goal, todo and workflow together in document order', () => {
    const panel = new CapabilityPanel()
    panel.set(
      { kind: 'goal', id: 'goal', objective: 'ship it', phase: 'active', maxGoalRounds: 3, roundsStarted: 1 },
      { kind: 'todo', id: 'todo', items: [{ content: 'write code', status: 'in_progress' }] },
      [],
      { runs: [{ runId: 'r', name: 'wf', state: 'running', members: [] }] },
    )
    const lines = panel.render(100).map(stripAnsi)
    expect(lines[0]).toContain('◆ goal')
    expect(lines.some(line => line.includes('◆ todo'))).toBe(true)
    expect(lines.some(line => line.includes('◆ workflow'))).toBe(true)
  })

  it('pulses a sprite on running job rows (CC-10)', () => {
    const panel = new CapabilityPanel()
    panel.set(undefined, undefined, [
      { id: 'j1', label: 'subagent sweep', status: 'running', startedAt: Date.now() - 5000 },
      { id: 'j2', label: 'done job', status: 'completed', startedAt: 1, finishedAt: 2 },
    ])
    panel.setJobsExpanded(true) // >1 job 默认收敛成一行，展开才渲染逐行
    const lines = panel.render(100).map(stripAnsi)
    const runningRow = lines.find(line => line.includes('subagent sweep'))
    expect(runningRow).toBeDefined()
    // 呼吸条由 ▐▓░ 四帧组成，任何一帧都含 ▐/▓/░ 字符。
    expect(runningRow).toMatch(/[▐▓░]{4}/)
    const doneRow = lines.find(line => line.includes('done job'))
    expect(doneRow).toContain('✓')
    expect(doneRow).not.toMatch(/[▐▓░]{4}/)
  })
})
