/**
 * The projection layer over the full DESIGN.md §3.1 mapping table: every event
 * folds into its documented entry operation, incremental folding equals
 * replay, and unknown events pass through untouched. Fixtures are hand-built
 * with the exact payload shapes verified against the DSH sources.
 */

import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionEventType } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-llm-retry'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-goal'
import { emptyDocument } from '../src/document/document.ts'
import type { AssistantEntry, ViewDocument, ViewEntry } from '../src/document/document.ts'
import { fold, replay } from '../src/projection/fold.ts'

let seq = 0
/** Hand-built event with the verified payload shape. */
function event<T extends SessionEventType>(type: T, data: SessionEvent<T>['data']): SessionEvent<T> {
  return { seq: seq++, type, data, time: Date.now() } as SessionEvent<T>
}

const textDelta = (turn: number, step: number, text: string) =>
  event('assistant/chunk', { turn, step, chunk: { type: 'text-delta', index: 0, text } })

/** Workflow events live outside the typed vocabulary: structural events. */
const wfEvent = (type: string, data: Record<string, unknown>) =>
  ({ seq: seq++, type, data, time: Date.now() }) as never
const reasoningDelta = (turn: number, step: number, text: string) =>
  event('assistant/chunk', { turn, step, chunk: { type: 'reasoning-delta', index: 1, text } })

function assistantMessage(turn: number, step: number, content: Array<{ type: string; text?: string }>, usage?: { inputTokens: number; outputTokens: number }) {
  return event('assistant/message', {
    turn, step,
    message: { id: `m-${turn}-${step}`, role: 'assistant', content, source: { kind: 'model', provider: 'test-provider', model: 'test-model' } },
    usage,
  } as never)
}

const userMessage = (text: string, source: { kind: string; [k: string]: unknown } = { kind: 'user' }) =>
  event('user/message', { id: `u-${seq}`, role: 'user', content: [{ type: 'text', text }], source } as never)

const toolCall = (callId: string, name: string, args: string) =>
  event('tool/call', { turn: 1, step: 1, callId, name, arguments: args } as never)

function toolResult(callId: string, blocks: Array<{ type: string; text?: string }>, extra: Record<string, unknown> = {}) {
  return event('tool/result', {
    turn: 1, step: 1,
    message: {
      id: `t-${callId}`, role: 'user',
      content: [{ type: 'tool-result', toolCallId: callId, content: blocks }],
      source: { kind: 'tool', callId },
    },
    ...extra,
  } as never)
}

function entriesOf(doc: ViewDocument, kind: ViewEntry['kind']): ViewEntry[] {
  return doc.entries.filter(entry => entry.kind === kind)
}

describe('projection', () => {
  it('starts empty and idle', () => {
    expect(emptyDocument()).toEqual({ entries: [], busy: false })
  })

  it('ignores unknown events without mutation', () => {
    const doc = emptyDocument()
    expect(fold({ seq: 0, type: 'hook/invoked', data: { point: 'PreToolUse', name: 'h' } } as never, doc)).toBe(doc)
  })

  it('opens a working status on turn/start and clears it on turn/end', () => {
    const start = fold(event('turn/start', { turn: 1 }), emptyDocument())
    expect(start.busy).toBe(true)
    expect(entriesOf(start, 'status')).toEqual([{ kind: 'status', id: 'turn:1', status: 'working', startedAt: expect.any(Number) }])
    const end = fold(event('turn/end', { turn: 1, reason: { kind: 'completed' } }), start)
    expect(end.busy).toBe(false)
    expect(entriesOf(end, 'status')).toEqual([])
  })

  it('renders injected context as system rows instead of dropping them', () => {
    const doc = replay([
      userMessage('workspace instructions line one\nline two', { kind: 'plugin', plugin: 'dsh-agent' }),
      userMessage('skill list', { kind: 'skill-catalog', form: 'catalog', entries: [{ name: 'audit', description: 'x' }, { name: 'daily-report', description: 'y' }] }),
      userMessage('continue', { kind: 'goal', goalId: 'g1', revision: 2, round: 3 }),
      userMessage('real question'),
    ])
    expect(entriesOf(doc, 'user').map(e => (e as { text: string }).text)).toEqual(['real question'])
    expect(entriesOf(doc, 'notice').map(e => (e as { text: string }).text)).toEqual([
      '注入 · plugin · dsh-agent — workspace instructions line one',
      '注入 · skill-catalog · audit, daily-report — skill list',
      '注入 · goal · 第 3 轮延续 — continue',
    ])
  })

  it('accumulates text and reasoning deltas into one streaming assistant entry', () => {
    const doc = replay([
      event('turn/start', { turn: 1 }),
      event('step/start', { turn: 1, step: 1 }),
      textDelta(1, 1, 'Hi'),
      textDelta(1, 1, ' there'),
      reasoningDelta(1, 1, 'thinking…'),
    ])
    const assistant = entriesOf(doc, 'assistant') as AssistantEntry[]
    expect(assistant).toHaveLength(1)
    expect(assistant[0].id).toBe('1:1')
    expect(assistant[0].state).toBe('streaming')
    expect(assistant[0].text).toBe('Hi there')
    expect(assistant[0].thinking).toEqual(['thinking…'])
  })

  it('commits the assembled message authoritatively, replacing streamed text', () => {
    const doc = replay([
      event('turn/start', { turn: 1 }),
      event('step/start', { turn: 1, step: 1 }),
      textDelta(1, 1, 'partial'),
      assistantMessage(1, 1, [{ type: 'text', text: 'final complete text' }], { inputTokens: 10, outputTokens: 5 }),
    ])
    const assistant = entriesOf(doc, 'assistant') as AssistantEntry[]
    expect(assistant).toEqual([{
      kind: 'assistant', id: '1:1', turn: 1, step: 1,
      seq: expect.any(Number), at: expect.any(Number), messageId: 'm-1-1',
      text: 'final complete text', thinking: [],
      state: 'committed',
      stats: expect.objectContaining({ runMs: expect.any(Number), ttftMs: expect.any(Number) }),
      usage: { inputTokens: 10, outputTokens: 5 },
    }])
  })

  it('computes wall-time stats for the assembled message (T1②)', () => {
    const doc = replay([
      { ...event('turn/start', { turn: 1 }), time: 1_000 },
      { ...event('step/start', { turn: 1, step: 1 }), time: 1_100 },
      { ...textDelta(1, 1, 'hello'), time: 1_500 },
      { ...assistantMessage(1, 1, [{ type: 'text', text: 'hello world' }], { inputTokens: 20, outputTokens: 200 }), time: 2_500 },
    ])
    const assistant = entriesOf(doc, 'assistant')[0] as AssistantEntry
    expect(assistant.stats).toEqual({
      runMs: 1_500,
      ttftMs: 500,
      tokensPerSecond: 200, // 200 tokens over exactly one decode second
    })
  })

  it('keeps reasoning blocks separate from text on commit', () => {
    const doc = replay([
      event('turn/start', { turn: 1 }),
      assistantMessage(1, 1, [{ type: 'reasoning', text: 'plan A' }, { type: 'reasoning', text: 'plan B' }, { type: 'text', text: 'answer' }]),
    ])
    const assistant = entriesOf(doc, 'assistant') as AssistantEntry[]
    expect(assistant[0].text).toBe('answer')
    expect(assistant[0].thinking).toEqual(['plan A', 'plan B'])
    expect(assistant[0].state).toBe('committed')
  })

  it('drops an empty assembled message (tool-call-only step)', () => {
    const doc = replay([
      event('turn/start', { turn: 1 }),
      event('step/start', { turn: 1, step: 1 }),
      textDelta(1, 1, ''),
      assistantMessage(1, 1, []),
    ])
    expect(entriesOf(doc, 'assistant')).toEqual([])
  })

  it('finalizes the streaming entry when a new step opens', () => {
    const doc = replay([
      event('turn/start', { turn: 1 }),
      event('step/start', { turn: 1, step: 1 }),
      textDelta(1, 1, 'step one'),
      event('step/end', { turn: 1, step: 1 }),
      event('step/start', { turn: 1, step: 2 }),
    ])
    const assistant = entriesOf(doc, 'assistant') as AssistantEntry[]
    expect(assistant[0].id).toBe('1:1')
    expect(assistant[0].state).toBe('committed')
    expect(assistant[0].text).toBe('step one')
  })

  it('tracks tool calls by callId through result, output, error and meta', () => {
    const doc = replay([
      toolCall('call-1', 'bash', '{"cmd":"ls"}'),
      toolResult('call-1', [{ type: 'text', text: 'ok' }], {
        meta: { diffs: [{ path: 'a.txt', oldText: null, newText: 'x' }] },
      }),
    ])
    expect(entriesOf(doc, 'tool')).toEqual([{
      kind: 'tool', id: 'call-1', callId: 'call-1', name: 'bash', arguments: '{"cmd":"ls"}',
      state: 'done', turn: 1, step: 1, calledAt: expect.any(Number), durationMs: expect.any(Number),
      output: { blocks: [{ type: 'text', text: 'ok' }] },
      meta: { diffs: [{ path: 'a.txt', oldText: null, newText: 'x' }] },
    }])
  })

  it('computes tool wall time from the call and result timestamps (T3②)', () => {
    const doc = replay([
      { ...toolCall('call-d', 'bash', '{"cmd":"sleep 1"}'), time: 1_000 },
      { ...toolResult('call-d', [{ type: 'text', text: 'ok' }]), time: 2_600 },
    ])
    const tool = entriesOf(doc, 'tool')[0] as { durationMs?: number; calledAt?: number }
    expect(tool.calledAt).toBe(1_000)
    expect(tool.durationMs).toBe(1_600)
  })

  it('marks tool errors from the result payload', () => {
    const doc = replay([
      toolCall('call-9', 'fs', '{}'),
      toolResult('call-9', [], { error: { name: 'SandboxError', code: 'DENIED' } }),
    ])
    const tool = entriesOf(doc, 'tool')[0] as { state: string; error?: unknown }
    expect(tool.state).toBe('error')
    expect(tool.error).toEqual({ name: 'SandboxError', code: 'DENIED' })
  })

  it('folds code-dispatch sub-calls into the parent tool tree (B3)', () => {
    const doc = replay([
      toolCall('run-1', 'run_code', '{"code":"run()"}'),
      event('tool/code-dispatch-start', {
        rootCallId: 'run-1', parentCallId: 'run-1', subCallId: 'run-1:code:0',
        name: 'bash', arguments: { command: 'echo hi' },
      } as never),
      event('tool/code-dispatch', {
        rootCallId: 'run-1', parentCallId: 'run-1', subCallId: 'run-1:code:0',
        name: 'bash', arguments: { command: 'echo hi' }, isError: false,
        content: [{ type: 'text', text: 'hi' }],
      } as never),
      toolResult('run-1', [{ type: 'text', text: 'done' }]),
    ])
    const tool = entriesOf(doc, 'tool')[0] as { children?: Array<Record<string, unknown>> }
    expect(tool.children).toEqual([{
      kind: 'tool', id: 'run-1:code:0', callId: 'run-1:code:0', name: 'bash',
      arguments: '{"command":"echo hi"}', state: 'done', calledAt: expect.any(Number),
      durationMs: expect.any(Number), output: { blocks: [{ type: 'text', text: 'hi' }] },
    }])
  })

  it('keeps nested sub-calls running until their code-dispatch settles', () => {
    const doc = replay([
      toolCall('run-2', 'run_code', '{}'),
      event('tool/code-dispatch-start', {
        rootCallId: 'run-2', parentCallId: 'run-2', subCallId: 'run-2:code:0',
        name: 'grep', arguments: { pattern: 'x' },
      } as never),
    ])
    const tool = entriesOf(doc, 'tool')[0] as { children?: Array<{ state: string }> }
    expect(tool.children?.[0]?.state).toBe('running')
  })

  it('settles nested code-dispatch children with error state', () => {
    const doc = replay([
      toolCall('run-3', 'run_code', '{}'),
      event('tool/code-dispatch-start', {
        rootCallId: 'run-3', parentCallId: 'run-3', subCallId: 'run-3:code:0',
        name: 'bash', arguments: {},
      } as never),
      event('tool/code-dispatch', {
        rootCallId: 'run-3', parentCallId: 'run-3', subCallId: 'run-3:code:0',
        name: 'bash', arguments: {}, isError: true, content: [],
      } as never),
    ])
    const tool = entriesOf(doc, 'tool')[0] as { children?: Array<{ state: string }> }
    expect(tool.children?.[0]?.state).toBe('error')
  })

  it('folds grandchildren code-dispatches recursively (B3 depth)', () => {
    const doc = replay([
      toolCall('run-4', 'run_code', '{}'),
      event('tool/code-dispatch-start', {
        rootCallId: 'run-4', parentCallId: 'run-4', subCallId: 'run-4:code:0',
        name: 'run_code', arguments: {},
      } as never),
      event('tool/code-dispatch-start', {
        rootCallId: 'run-4', parentCallId: 'run-4:code:0', subCallId: 'run-4:code:0:code:0',
        name: 'bash', arguments: { command: 'ls' },
      } as never),
      event('tool/code-dispatch', {
        rootCallId: 'run-4', parentCallId: 'run-4:code:0:code:0', subCallId: 'run-4:code:0:code:0',
        name: 'bash', arguments: { command: 'ls' }, isError: false,
        content: [{ type: 'text', text: 'a.txt' }],
      } as never),
    ])
    const tool = entriesOf(doc, 'tool')[0] as {
      children?: Array<{ children?: Array<{ callId: string; state: string }> }>
    }
    expect(tool.children?.[0]?.children?.[0]?.callId).toBe('run-4:code:0:code:0')
    expect(tool.children?.[0]?.children?.[0]?.state).toBe('done')
  })

  it('appends compaction status entries with the summary detail', () => {
    const doc = replay([
      event('compaction/summary', {
        compactionId: 'c1', summary: [{ type: 'text', text: 'earlier work summarized' }],
        shadowedRange: { start: 2, end: 9 }, shadowedSeqs: [], shadowedTokenCount: 1234,
        provider: 'test-provider', model: 'test-model',
      } as never),
    ])
    expect(entriesOf(doc, 'status')).toEqual([{
      kind: 'status', id: 'compaction:c1', status: 'compaction',
      detail: { summaryText: 'earlier work summarized', shadowedTokenCount: 1234 },
    }])
  })

  it('shows the retry countdown from llm/retry and keeps the row across llm/retry-started', () => {
    // The harness appends `llm/retry` (policy + delay) before the backoff
    // wait, then a sparse `llm/retry-started` once the wait elapsed.
    const scheduled = fold(event('llm/retry', {
      retryId: 'r1', turn: 1, step: 1, provider: 'test-provider', mode: 'normal', policyKey: 'k',
      retry: 1, maxRetries: 3, delayMs: 1000, failure: { code: 'TIMEOUT', message: 'x' },
    } as never), emptyDocument())
    expect(entriesOf(scheduled, 'status')).toEqual([{
      kind: 'status', id: 'retry:r1', status: 'retry',
      detail: { attempt: 1, maxAttempts: 3, delayMs: 1000, failure: { code: 'TIMEOUT', message: 'x' } },
    }])
    // `llm/retry-started` carries no policy data: the row keeps the attempt,
    // the elapsed countdown (delayMs 0) and the failure reason (A12).
    const started = fold(event('llm/retry-started', {
      retryId: 'r1', turn: 1, step: 1, retry: 1,
    } as never), scheduled)
    expect(entriesOf(started, 'status')).toEqual([{
      kind: 'status', id: 'retry:r1', status: 'retry',
      detail: { attempt: 1, maxAttempts: 3, delayMs: 0, failure: { code: 'TIMEOUT', message: 'x' } },
    }])
    // The row clears when the turn ends (a successful retry leaves no stale row).
    const ended = fold(event('turn/end', { turn: 1, reason: { kind: 'done' } } as never), started)
    expect(entriesOf(ended, 'status')).toEqual([])
  })

  it('records approval asked/decided pairs', () => {
    const asked = fold(event('approval/asked', { id: 'a1', toolName: 'bash', callId: 'call-1', reason: 'runs rm' } as never), emptyDocument())
    expect(entriesOf(asked, 'approval')).toEqual([{
      kind: 'approval', id: 'approval:a1', toolName: 'bash', callId: 'call-1', reason: 'runs rm', state: 'pending',
    }])
    const decided = fold(event('approval/decided', { id: 'a1', outcome: 'allowed-once' } as never), asked)
    expect((entriesOf(decided, 'approval')[0] as { state: string; outcome?: string })).toEqual({
      kind: 'approval', id: 'approval:a1', toolName: 'bash', callId: 'call-1', reason: 'runs rm',
      state: 'decided', outcome: 'allowed-once',
    })
  })

  it('upserts and clears the goal entry from goal/change events', () => {
    const withGoal = fold(event('goal/change', {
      kind: 'goal/change', version: 1, operation: 'set', goal: {
        id: 'g1', objective: 'finish the work', phase: 'active', maxGoalRounds: 8,
      },
      roundsStarted: 3, createdAt: 1000, updatedAt: 2000,
    } as never), emptyDocument())
    expect(entriesOf(withGoal, 'goal')).toEqual([{
      kind: 'goal', id: 'goal', objective: 'finish the work', phase: 'active', maxGoalRounds: 8, roundsStarted: 3,
    }])
    const cleared = fold(event('goal/change', {
      kind: 'goal/change', version: 1, operation: 'clear', cleared: { id: 'g1' }, clearedAt: 3000,
    } as never), withGoal)
    expect(entriesOf(cleared, 'goal')).toEqual([])
  })

  it('replaces the todo entry on every todo/write', () => {
    const doc = replay([
      event('todo/write', { todos: [{ content: 'a', status: 'pending' }, { content: 'b', status: 'in_progress' }] } as never),
      event('todo/write', { todos: [{ content: 'a', status: 'completed' }] } as never),
    ])
    expect(entriesOf(doc, 'todo')).toEqual([{
      kind: 'todo', id: 'todo', items: [{ content: 'a', status: 'completed' }],
    }])
  })

  it('records an error notice for failed turns', () => {
    const doc = replay([
      event('turn/start', { turn: 1 }),
      event('turn/end', { turn: 1, reason: { kind: 'error', error: { code: 'TIMEOUT', message: 'upstream timed out' } } }),
    ])
    expect(doc.busy).toBe(false)
    expect(entriesOf(doc, 'notice')).toEqual([{
      kind: 'notice', id: 'notice:1', text: 'Error: TIMEOUT: upstream timed out', tone: 'error',
    }])
    expect(entriesOf(doc, 'status')).toEqual([])
  })

  it('records an interrupted notice for aborted turns', () => {
    const doc = replay([
      event('turn/start', { turn: 1 }),
      event('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }),
    ])
    expect(entriesOf(doc, 'notice')).toEqual([
      { kind: 'notice', id: 'notice:1', text: '已中断', tone: 'info' },
    ])
  })

  it('badges the turn outcome on its assistant message instead of a notice (P0)', () => {
    const doc = replay([
      event('turn/start', { turn: 1 }),
      textDelta(1, 1, 'partial answer'),
      event('turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } }),
    ])
    expect(entriesOf(doc, 'notice')).toEqual([])
    const assistants = entriesOf(doc, 'assistant') as AssistantEntry[]
    expect(assistants).toHaveLength(1)
    expect(assistants[0]).toMatchObject({
      text: 'partial answer',
      outcome: { text: '已中断', tone: 'info' },
    })
    // The max-tokens ceiling badges the message the same way.
    const ceiling = replay([
      event('turn/start', { turn: 2 }),
      textDelta(2, 1, 'cut off'),
      event('turn/end', { turn: 2, reason: { kind: 'max-tokens' } }),
    ])
    const assistant = (entriesOf(ceiling, 'assistant') as AssistantEntry[])[0]
    expect(assistant.outcome).toEqual({ text: '达到输出 token 上限', tone: 'info' })
    expect(entriesOf(ceiling, 'notice')).toEqual([])
  })

  it('carries the cache buckets through assistant/message (web stats parity)', () => {
    const doc = replay([
      event('turn/start', { turn: 1 }),
      event('assistant/message', {
        turn: 1, step: 1,
        message: { id: 'm-1-1', role: 'assistant', content: [{ type: 'text', text: 'hi' }], source: { kind: 'model', provider: 'test-provider', model: 'test-model' } },
        usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 2 },
      } as never),
    ])
    const assistant = (entriesOf(doc, 'assistant') as AssistantEntry[])[0]
    expect(assistant.usage).toEqual({ inputTokens: 10, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 2 })
  })

  it('records a token-ceiling notice for max-tokens turns', () => {
    const doc = replay([
      event('turn/start', { turn: 1 }),
      event('turn/end', { turn: 1, reason: { kind: 'max-tokens' } }),
    ])
    expect(entriesOf(doc, 'notice')).toEqual([
      { kind: 'notice', id: 'notice:1', text: '达到输出 token 上限', tone: 'info' },
    ])
  })

  it('records system-row notices for title, preset and plan-mode events', () => {
    const doc = replay([
      event('session/title', { title: 'build the tui' } as never),
      event('permission/preset', { preset: 'workspace-write' } as never),
      event('plan/mode', { active: true } as never),
    ])
    expect(entriesOf(doc, 'notice').map(e => (e as { text: string }).text)).toEqual([
      '会话标题：build the tui', '权限预设：workspace-write', '进入 plan 模式（提案待审）',
    ])
    // The preset also pins to the fixed status slot above the input line.
    expect(doc.permissionPreset).toBe('workspace-write')
  })

  it('records subagent descriptor and feedback rows', () => {
    const doc = replay([
      event('subagent/descriptor', { version: 2, mode: 'one-shot', provider: 'in-process', label: 'audit the repo' } as never),
      event('feedback/record', { text: 'accurate' } as never),
    ])
    expect(entriesOf(doc, 'notice').map(e => (e as { text: string }).text)).toEqual([
      '◆ subagent · audit the repo', '🔒 一次性子代理会话 · 只读', '反馈：accurate',
    ])
  })

  it('flags one-shot subagent sessions read-only (E10)', () => {
    const oneShot = replay([
      event('subagent/descriptor', { version: 2, mode: 'one-shot', provider: 'in-process', label: 'audit' } as never),
    ])
    expect(oneShot.readOnlyHint).toBe('one-shot-subagent')
    expect(entriesOf(oneShot, 'notice').map(e => (e as { text: string }).text)).toEqual([
      '◆ subagent · audit', '🔒 一次性子代理会话 · 只读',
    ])
    // Continuable children stay editable.
    const continuable = replay([
      event('subagent/descriptor', { version: 2, mode: 'continuable', provider: 'in-process', label: 'round-2' } as never),
    ])
    expect(continuable.readOnlyHint).toBeUndefined()
  })

  it('folds workflow runs and members into the panel state (E15/H32)', () => {
    const doc = replay([
      wfEvent('tool-workflow/run-start', { runId: 'run-1', name: 'audit sweep' }),
      wfEvent('tool-workflow/agent-start', { runId: 'run-1', seq: 0, label: 'agent A', phase: 'scan', childId: 'session-a' }),
      wfEvent('tool-workflow/agent-start', { runId: 'run-1', seq: 1, label: 'agent B', childId: 'session-b' }),
      wfEvent('tool-workflow/agent-end', { runId: 'run-1', seq: 0, outcome: 'completed' }),
      wfEvent('tool-workflow/agent-end', { runId: 'run-1', seq: 1, outcome: 'failed' }),
      wfEvent('tool-workflow/run-end', { runId: 'run-1', stopReason: 'error' }),
    ])
    expect(doc.workflow).toEqual({
      runs: [{
        runId: 'run-1', name: 'audit sweep', state: 'error',
        members: [
          { seq: 0, label: 'agent A', phase: 'scan', childId: 'session-a', outcome: 'completed' },
          { seq: 1, label: 'agent B', childId: 'session-b', outcome: 'failed' },
        ],
      }],
    })
    // Run boundaries leave transcript audit rows.
    expect(entriesOf(doc, 'notice').map(e => (e as { text: string }).text)).toEqual([
      '◆ workflow · audit sweep', '✓ workflow 结束 · error',
    ])
  })

  it('keeps member settlement idempotent and appends later runs', () => {
    const doc = replay([
      wfEvent('tool-workflow/run-start', { runId: 'run-1', name: 'first' }),
      wfEvent('tool-workflow/agent-start', { runId: 'run-1', seq: 0, label: 'A', childId: 's-a' }),
      // Duplicate agent-start for the same seq must not duplicate the member.
      wfEvent('tool-workflow/agent-start', { runId: 'run-1', seq: 0, label: 'A', childId: 's-a' }),
      wfEvent('tool-workflow/run-end', { runId: 'run-1', stopReason: 'completed' }),
      wfEvent('tool-workflow/run-start', { runId: 'run-2', name: 'second' }),
    ])
    expect(doc.workflow?.runs.map(run => run.runId)).toEqual(['run-1', 'run-2'])
    expect(doc.workflow?.runs[0].members).toHaveLength(1)
    expect(doc.workflow?.runs[0].state).toBe('completed')
  })

  it('tracks the plan-mode flag on plan/mode events', () => {
    const doc = replay([
      event('plan/mode', { active: true } as never),
    ])
    expect(doc.planMode).toBe(true)
    const exited = fold(event('plan/mode', { active: false } as never), doc)
    expect(exited.planMode).toBe(false)
  })

  it('replays to the same document as incremental folding', () => {
    const events = [
      event('turn/start', { turn: 1 }),
      event('step/start', { turn: 1, step: 1 }),
      userMessage('hello agent'),
      textDelta(1, 1, 'Hi'),
      textDelta(1, 1, ' there'),
      reasoningDelta(1, 1, 'hmm'),
      assistantMessage(1, 1, [{ type: 'reasoning', text: 'hmm' }, { type: 'text', text: 'Hi there' }]),
      toolCall('call-1', 'bash', '{"cmd":"ls"}'),
      toolResult('call-1', [{ type: 'text', text: 'ok' }]),
      event('step/end', { turn: 1, step: 1 }),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    const folded = events.reduce((doc, e) => fold(e, doc), emptyDocument())
    expect(replay(events)).toEqual(folded)
    expect(folded.busy).toBe(false)
    expect(folded.entries.map(e => e.kind)).toEqual(['user', 'assistant', 'tool'])
  })
})
