/**
 * The interactive answerer seams: the approval/request waterfall (chain-tail
 * presentation with passthrough) and the user-questions/request answerer
 * (alpha.5 起为 Agent 作用域 cascade 事件，而非 service 上的 provider 注册)。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-user-approval'
import { installApprovals } from '../../src/control/approvals.ts'
import type { ApprovalPresenter } from '../../src/control/approvals.ts'
import type { ApprovalAnswer, ApprovalQuestion } from '../../src/view/components/approval-view.ts'

const disposers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

function makePresenter(): ApprovalPresenter & {
  asked: ApprovalQuestion[]
  answer: (i: number) => void
  answerText: (text: string) => void
  resolve: (i: number, answer: Partial<ApprovalAnswer> & { reason: ApprovalAnswer['reason'] }) => void
} {
  const asked: ApprovalQuestion[] = []
  const pending: Array<{ question: ApprovalQuestion; resolve: (answer: ApprovalAnswer) => void }> = []
  return {
    asked,
    answer: (i: number) => {
      const entry = pending.splice(i, 1)[0]
      entry?.resolve({ picked: entry.question.options[0], reason: 'picked' })
    },
    answerText: (text: string) => {
      const entry = pending.splice(0, 1)[0]
      entry?.resolve({ picked: text, reason: 'picked' })
    },
    resolve: (i: number, answer: Partial<ApprovalAnswer> & { reason: ApprovalAnswer['reason'] }) => {
      const entry = pending.splice(i, 1)[0]
      entry?.resolve(answer as ApprovalAnswer)
    },
    present(question) {
      asked.push(question)
      return new Promise(resolve => pending.push({ question, resolve }))
    },
  }
}

const request = (agentId: string) => ({ agent: { id: agentId }, toolName: 'bash', reason: 'runs rm', signal: undefined })

/** 经 user-questions/request 事件向 TUI answerer 提问（fallback 抛错：应被 claim）。 */
function askQuestions(ctx: Context, questions: unknown[]): Promise<{ answers: Array<{ id: string; selected: string[]; custom?: string }> }> {
  return (ctx.waterfall as unknown as (
    carrier: object, event: string, request: unknown, next: () => Promise<unknown>,
  ) => Promise<{ answers: Array<{ id: string; selected: string[]; custom?: string }> }>)(
    Object.create(null), 'user-questions/request', { questions },
    async () => { throw new Error('unexpected fallback: the TUI answerer must claim') },
  )
}

describe('approval seams', () => {
  it('lets earlier answerers decide without presenting', async () => {
    const ctx = new Context()
    const presenter = makePresenter()
    installApprovals(ctx, presenter, () => 'agent-1')
    const outcome = await (ctx.waterfall as (...args: unknown[]) => Promise<string>)(Object.create(null), 'approval/request', request('agent-1'), async () => 'rejected' as const)
    expect(outcome).toBe('rejected')
    expect(presenter.asked).toEqual([])
    await ctx.fiber.dispose()
  })

  it('passes through requests for other agents', async () => {
    const ctx = new Context()
    const presenter = makePresenter()
    installApprovals(ctx, presenter, () => 'agent-1')
    const outcome = await (ctx.waterfall as (...args: unknown[]) => Promise<string>)(Object.create(null), 'approval/request', request('agent-2'), async () => 'unavailable' as const)
    expect(outcome).toBe('unavailable')
    expect(presenter.asked).toEqual([])
    await ctx.fiber.dispose()
  })

  it('presents when nobody claimed the request and maps the choice', async () => {
    const ctx = new Context()
    const presenter = makePresenter()
    installApprovals(ctx, presenter, () => 'agent-1')
    const outcomePromise = (ctx.waterfall as (...args: unknown[]) => Promise<string>)(Object.create(null), 'approval/request', request('agent-1'), async () => 'unavailable' as const)
    await Promise.resolve()
    expect(presenter.asked).toHaveLength(1)
    expect(presenter.asked[0].title).toContain('bash')
    presenter.answer(0) // first option = 'Allow once'
    expect(await outcomePromise).toBe('allowed-once')
    await ctx.fiber.dispose()
  })

  it('enriches the permission dialog with the command and impact lines (CC-02)', async () => {
    const ctx = new Context()
    const presenter = makePresenter()
    installApprovals(ctx, presenter, () => 'agent-1', 120_000, {
      lookupToolCall: (callId) => callId === 'call-1'
        ? { commandText: 'rm -rf /tmp/x', impactLines: ['将修改：/tmp/x'] }
        : undefined,
    })
    const outcomePromise = (ctx.waterfall as (...args: unknown[]) => Promise<string>)(
      Object.create(null), 'approval/request', { ...request('agent-1'), callId: 'call-1' }, async () => 'unavailable' as const,
    )
    await Promise.resolve()
    expect(presenter.asked[0].commandText).toBe('rm -rf /tmp/x')
    expect(presenter.asked[0].impactLines).toEqual(['将修改：/tmp/x'])
    presenter.answer(0)
    expect(await outcomePromise).toBe('allowed-once')
    await ctx.fiber.dispose()
  })

  it('claims user-questions requests through the waterfall and answers an option question', async () => {
    const ctx = new Context()
    const presenter = makePresenter()
    installApprovals(ctx, presenter, () => 'agent-1')
    const answerPromise = askQuestions(ctx, [{ id: 'q1', question: 'which one?', options: [{ label: 'A' }, { label: 'B' }] }])
    await Promise.resolve()
    expect(presenter.asked[0].options).toEqual(['A', 'B'])
    presenter.answer(0)
    expect(await answerPromise).toEqual({ answers: [{ id: 'q1', selected: ['A'] }] })
    await ctx.fiber.dispose()
  })

  it('encodes free-text answers through the custom slot', async () => {
    const ctx = new Context()
    const presenter = makePresenter()
    installApprovals(ctx, presenter, () => 'agent-1')
    // Free-text question: presenter is asked with zero options; resolve it
    // with typed text by reaching into the pending present call.
    const answerPromise = askQuestions(ctx, [{ id: 'q1', question: 'what name?' }])
    await Promise.resolve()
    expect(presenter.asked[0].options).toEqual([])
    presenter.answerText('小明')
    expect(await answerPromise).toEqual({ answers: [{ id: 'q1', selected: [], custom: '小明' }] })
    await ctx.fiber.dispose()
  })

  it('encodes plan-review feedback through the custom slot alongside the keep-planning pick (B11)', async () => {
    const ctx = new Context()
    const presenter = makePresenter()
    installApprovals(ctx, presenter, () => 'agent-1')
    // plan-review：选项 = 批准 + 继续规划；意图标记传给对话框（detailMarkdown）。
    const answerPromise = askQuestions(ctx, [{
      id: 'plan-review', question: 'Approve the plan?',
      detail: '# Plan', intent: { kind: 'plan-review', approve: '批准' },
      options: [{ label: '批准' }, { label: '继续规划' }],
    }])
    await Promise.resolve()
    const asked = presenter.asked[0]
    expect(asked.detailMarkdown).toBe(true)
    expect(asked.approveLabel).toBe('批准')
    // 反馈行 Enter：继续规划 + 反馈文本 → selected 带非批准选项 + custom。
    presenter.resolve(0, { picked: '继续规划', custom: '改用 C 方案', reason: 'picked' })
    expect(await answerPromise).toEqual({ answers: [{ id: 'plan-review', selected: ['继续规划'], custom: '改用 C 方案' }] })
    await ctx.fiber.dispose()
  })

  it('carries progress, header, descriptions and multiSelect to the dialog', async () => {
    const ctx = new Context()
    const presenter = makePresenter()
    installApprovals(ctx, presenter, () => 'agent-1')
    const answerPromise = askQuestions(ctx, [{
      id: 'q1', question: 'pick colors', header: 'palette', multiSelect: true,
      options: [{ label: 'red', description: 'warm' }, { label: 'blue' }],
    }])
    await Promise.resolve()
    const asked = presenter.asked[0]
    expect(asked.header).toBe('palette')
    expect(asked.multiSelect).toBe(true)
    expect(asked.optionDescriptions).toEqual(['warm', undefined])
    // A single-question request carries no progress marker, can be skipped
    // but has nothing to go back to.
    expect(asked.progress).toBeUndefined()
    expect(asked.skipLabel).not.toBeUndefined()
    expect(asked.backLabel).toBeUndefined()
    presenter.answer(0)
    expect(await answerPromise).toEqual({ answers: [{ id: 'q1', selected: ['red'] }] })
    await ctx.fiber.dispose()
  })

  it('answers multi-select questions with the confirmed label set', async () => {
    const ctx = new Context()
    const presenter = makePresenter()
    installApprovals(ctx, presenter, () => 'agent-1')
    const answerPromise = askQuestions(ctx, [{
      id: 'q1', question: 'pick colors', multiSelect: true,
      options: [{ label: 'red' }, { label: 'green' }, { label: 'blue' }],
    }])
    await Promise.resolve()
    presenter.resolve(0, { pickedMultiple: ['red', 'blue'], reason: 'picked' })
    expect(await answerPromise).toEqual({ answers: [{ id: 'q1', selected: ['red', 'blue'] }] })
    await ctx.fiber.dispose()
  })

  it('skips and goes back across a multi-question request', async () => {
    const ctx = new Context()
    const presenter = makePresenter()
    installApprovals(ctx, presenter, () => 'agent-1')
    const answerPromise = askQuestions(ctx, [
      { id: 'q1', question: 'one?', options: [{ label: 'A' }] },
      { id: 'q2', question: 'two?', options: [{ label: 'B' }] },
      { id: 'q3', question: 'three?', options: [{ label: 'C' }] },
    ])
    await Promise.resolve()
    // q1: progress 1/3, nothing to go back to, skippable.
    expect(presenter.asked[0].progress).toEqual({ index: 1, total: 3 })
    expect(presenter.asked[0].backLabel).toBeUndefined()
    presenter.answer(0) // q1 → A
    await Promise.resolve()
    // q2: progress 2/3; go back to q1.
    expect(presenter.asked[1].progress).toEqual({ index: 2, total: 3 })
    expect(presenter.asked[1].backLabel).not.toBeUndefined()
    presenter.resolve(0, { back: true, reason: 'picked' })
    await Promise.resolve()
    // Back re-presents q1; answer it again, then skip q2 (asked[3] is the
    // re-presented q2; the skip advances past it without recording an answer).
    expect(presenter.asked[2].title).toBe('one?')
    presenter.answer(0) // q1 → A again
    await Promise.resolve()
    expect(presenter.asked[3].title).toBe('two?')
    presenter.resolve(0, { skipped: true, reason: 'picked' })
    await Promise.resolve()
    // q3 answered; the answers omit the skipped q2.
    expect(presenter.asked[4].title).toBe('three?')
    presenter.answer(0)
    expect(await answerPromise).toEqual({ answers: [{ id: 'q1', selected: ['A'] }, { id: 'q3', selected: ['C'] }] })
    await ctx.fiber.dispose()
  })

  it('drops the remaining questions when the user cancels the group', async () => {
    const ctx = new Context()
    const presenter = makePresenter()
    installApprovals(ctx, presenter, () => 'agent-1')
    const answerPromise = askQuestions(ctx, [
      { id: 'q1', question: 'one?', options: [{ label: 'A' }] },
      { id: 'q2', question: 'two?', options: [{ label: 'B' }] },
    ])
    await Promise.resolve()
    presenter.resolve(0, { reason: 'cancelled' })
    expect(await answerPromise).toEqual({ answers: [] })
    // The second question was never presented.
    expect(presenter.asked).toHaveLength(1)
    await ctx.fiber.dispose()
  })

  it('installs on a bare context with no userQuestions service', async () => {
    const ctx = new Context()
    const presenter = makePresenter()
    // No userQuestions service provided — the answerer now rides the cordis
    // event waterfall, so installation never depends on the service.
    expect(() => installApprovals(ctx, presenter, () => 'agent-1')).not.toThrow()
    await ctx.fiber.dispose()
  })
})
