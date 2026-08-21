/**
 * FooterLine 压力条分段回归：G42 三段 breakdown（system/tools/messages）
 * 与 CC-07 两段回退（cache/surface）的着色结构。
 */

import { describe, expect, it } from 'vitest'
import { FooterLine } from '../src/view/components/footer.ts'

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
}

describe('footer context pressure bar', () => {
  it('segments the bar by token-meter breakdown when provided (G42)', () => {
    const line = new FooterLine()
    const doc = {
      entries: [{ kind: 'assistant', id: 'a', turn: 1, step: 1, text: 'x', thinking: [], state: 'committed' }],
      busy: false,
    } as never
    line.set(doc, '/ws', '', {
      contextWindow: 100_000,
      model: 'pi-ai/deepseek-v4',
      breakdown: { systemTokens: 5000, toolsTokens: 5000, messageTokens: 0 },
    })
    const rendered = line.render(200).map(stripAnsi)
    const facts = rendered[rendered.length - 1]
    // 10% 用量 → 1 段填充：system 先填。
    expect(facts).toContain('ctx 10%')
    expect(facts).toMatch(/▓{1}░{9}/)
  })

  it('falls back to the cache/surface two-segment bar without a breakdown (CC-07)', () => {
    const line = new FooterLine()
    const doc = {
      entries: [{
        kind: 'assistant', id: 'a', turn: 1, step: 1, text: 'x', thinking: [], state: 'committed',
        usage: { inputTokens: 4000, outputTokens: 1000, cacheReadTokens: 2500 },
      }],
      busy: false,
    } as never
    line.set(doc, '/ws', '', { contextWindow: 100_000 })
    const rendered = line.render(200).map(stripAnsi)
    const facts = rendered[rendered.length - 1]
    expect(facts).toContain('ctx 5%')
    // 5% 用量 → 不足 1 段时四舍五入为 1 段。
    expect(facts).toMatch(/▓/)
  })

  it('keeps the neutral empty bar at zero usage', () => {
    const line = new FooterLine()
    line.set({ entries: [], busy: false } as never, '/ws', '', { contextWindow: 100_000 })
    const rendered = line.render(200).map(stripAnsi)
    expect(rendered[rendered.length - 1]).toContain('ctx 0%')
    expect(rendered[rendered.length - 1]).toContain('░'.repeat(10))
  })
})

describe('footer reasoning effort', () => {
  it('shows the effort display name right after the model when set', () => {
    const line = new FooterLine()
    line.set({ entries: [], busy: false } as never, '/ws', '', { model: 'pi-ai/deepseek-v4', effort: 'high' })
    const facts = line.render(200).map(stripAnsi).at(-1)!
    expect(facts).toContain('pi-ai/deepseek-v4 · high · /ws')
  })

  it('omits the effort segment when no effort is selected', () => {
    const line = new FooterLine()
    line.set({ entries: [], busy: false } as never, '/ws', '', { model: 'pi-ai/deepseek-v4' })
    const facts = line.render(200).map(stripAnsi).at(-1)!
    expect(facts).toContain('pi-ai/deepseek-v4 · /ws')
    expect(facts).not.toContain('· high')
  })
})

describe('footer permission preset', () => {
  it('shows the web-style display name after model/effort (PermissionSelect parity)', () => {
    const line = new FooterLine()
    line.set({ entries: [], busy: false, permissionPreset: 'workspace-write' } as never, '/ws', '',
      { model: 'pi-ai/deepseek-v4', effort: 'high' })
    const facts = line.render(200).map(stripAnsi).at(-1)!
    expect(facts).toContain('pi-ai/deepseek-v4 · high · Workspace Write · /ws')
  })

  it('renders Full access for danger-full-access and omits the segment when unset', () => {
    const line = new FooterLine()
    line.set({ entries: [], busy: false, permissionPreset: 'danger-full-access' } as never, '/ws', '',
      { model: 'pi-ai/deepseek-v4' })
    const facts = line.render(200).map(stripAnsi).at(-1)!
    expect(facts).toContain('pi-ai/deepseek-v4 · Full access · /ws')
    const bare = new FooterLine()
    bare.set({ entries: [], busy: false } as never, '/ws', '', { model: 'pi-ai/deepseek-v4' })
    expect(bare.render(200).map(stripAnsi).at(-1)).not.toContain('Full access')
  })
})
