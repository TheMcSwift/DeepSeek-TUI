/**
 * The Projection layer: DSH `SessionEvent` log → ViewDocument. Pure functions —
 * no cordis, no pi, no terminal. The mapping table is DESIGN.md §3.1; every
 * case here has a corresponding test in tests/projection.spec.ts.
 * @module dsh-tui-app/projection/fold
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
// Empty type imports widen the SessionEventMap with the plugin-owned event
// vocabulary this projection consumes (compaction, retries, approvals, goals).
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-llm-retry'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-command-feedback'
// 纯函数显示变换（kebab → 标题大小写），无 cordis/pi/IO，不破坏 fold 纯性。
import { permissionDisplayName } from '../app/pi/command-match.ts'
import { emptyDocument, joinTextBlocks } from '../document/document.ts'
import type {
  ApprovalEntry,
  AssistantEntry,
  AssistantStats,
  DshContentBlock,
  GoalEntry,
  JsonValue,
  NoticeEntry,
  StatusEntry,
  TodoEntry,
  ToolEntry,
  TurnOutcome,
  UserEntry,
  ViewDocument,
  ViewEntry,
} from '../document/document.ts'

/** One compact system-row label for an injected non-user message (T1③). */
function injectRowText(source: { kind: string } & Record<string, unknown>, text: string): string {
  let label = source.kind
  if (source.kind === 'skill-catalog') {
    const entries = (source.entries ?? []) as Array<{ name: string }>
    const names = entries.slice(0, 3).map(entry => entry.name).join(', ')
    label = `skill-catalog · ${names}${entries.length > 3 ? ` +${entries.length - 3}` : ''}`
  } else if (source.kind === 'goal' && typeof source.round === 'number') {
    label = `goal · 第 ${String(source.round)} 轮延续`
  } else if (source.kind === 'plugin' && typeof source.plugin === 'string') {
    label = `plugin · ${String(source.plugin)}`
  } else if (source.kind === 'agent-instructions') {
    label = 'agent-instructions'
  }
  const firstLine = text.split('\n').find(line => line.trim() !== '') ?? ''
  const preview = firstLine.length <= 60 ? firstLine : `${firstLine.slice(0, 59)}…`
  return preview === '' ? `注入 · ${label}` : `注入 · ${label} — ${preview}`
}

/** Insert or replace the entry with `id`, preserving order. */
function upsert(doc: ViewDocument, id: string, entry: ViewEntry): ViewDocument {
  const index = doc.entries.findIndex(existing => existing.id === id)
  if (index === -1) return { ...doc, entries: [...doc.entries, entry] }
  const entries = [...doc.entries]
  entries[index] = entry
  return { ...doc, entries }
}

/** Remove the entry with `id`; same reference when nothing matched. */
function removeEntry(doc: ViewDocument, id: string): ViewDocument {
  const entries = doc.entries.filter(entry => entry.id !== id)
  return entries.length === doc.entries.length ? doc : { ...doc, entries }
}

/** Map one entry with `id`; same reference when nothing matched. */
function updateById(doc: ViewDocument, id: string, update: (entry: ViewEntry) => ViewEntry): ViewDocument {
  const index = doc.entries.findIndex(entry => entry.id === id)
  if (index === -1) return doc
  const entries = [...doc.entries]
  entries[index] = update(entries[index])
  return { ...doc, entries }
}

/**
 * Map one tool entry with `callId` anywhere in the tree — top level or
 * nested as a `tool/code-dispatch` child (B3). Same reference when nothing
 * matched; parents are re-created (structural sharing) along the path.
 */
function updateToolTree(doc: ViewDocument, callId: string, update: (entry: ToolEntry) => ToolEntry): ViewDocument {
  const mapEntry = (entry: ViewEntry): ViewEntry => {
    if (entry.kind !== 'tool') return entry
    if (entry.callId === callId) return update(entry)
    if (entry.children === undefined) return entry
    const mapped = entry.children.map(child => mapEntry(child) as ToolEntry)
    const changed = mapped.some((child, index) => child !== entry.children![index])
    return changed ? { ...entry, children: mapped } : entry
  }
  const entries = doc.entries.map(mapEntry)
  return entries.some((entry, index) => entry !== doc.entries[index]) ? { ...doc, entries } : doc
}

/** Move the streaming assistant entry (if any) to committed. */
function commitStreaming(doc: ViewDocument): ViewDocument {
  const streaming = doc.entries.find(entry => entry.kind === 'assistant' && entry.state === 'streaming')
  if (streaming === undefined) return doc
  return updateById(doc, streaming.id, entry => entry.kind === 'assistant' ? { ...entry, state: 'committed' } : entry)
}

/** Append a text/reasoning delta to the streaming assistant entry for the step. */
function appendStreaming(doc: ViewDocument, turn: number, step: number, text: string, thinking: string, at: number): ViewDocument {
  const id = `${turn}:${step}`
  const existing = doc.entries.find(entry => entry.id === id && entry.kind === 'assistant')
  if (existing === undefined || existing.kind !== 'assistant') {
    const entry: AssistantEntry = {
      kind: 'assistant', id, turn, step, text,
      thinking: thinking === '' ? [] : [thinking],
      state: 'streaming',
      firstChunkAt: at,
    }
    return { ...doc, entries: [...doc.entries, entry] }
  }
  const nextThinking = [...existing.thinking]
  if (thinking !== '') {
    if (nextThinking.length === 0) nextThinking.push(thinking)
    else nextThinking[nextThinking.length - 1] += thinking
  }
  return updateById(doc, id, entry => entry.kind === 'assistant'
    ? { ...entry, text: entry.text + text, thinking: nextThinking }
    : entry)
}

/**
 * Workflow runs (E15/H32): the tool-workflow plugin's events live outside
 * this package's typed vocabulary, so they fold structurally here (the
 * main switch never sees them). Run boundaries also leave transcript rows
 * for the audit trail; member state feeds the capability panel.
 */
function foldWorkflow(event: SessionEvent, doc: ViewDocument): ViewDocument | undefined {
  const type = (event as { type: string }).type
  if (type === 'tool-workflow/run-start') {
    const data = (event as { data: { runId: string; name: string } }).data
    const runs = [...(doc.workflow?.runs ?? [])]
    if (!runs.some(run => run.runId === data.runId)) {
      runs.push({ runId: data.runId, name: data.name, state: 'running', members: [] })
    }
    const notice: NoticeEntry = {
      kind: 'notice', id: `workflow:${data.runId}:start`, text: `◆ workflow · ${data.name}`, tone: 'info',
    }
    return { ...doc, workflow: { runs }, entries: [...doc.entries, notice] }
  }
  if (type === 'tool-workflow/agent-start') {
    const data = (event as { data: { runId: string; seq: number; label: string; phase?: string; childId: string } }).data
    const runs = (doc.workflow?.runs ?? []).map(run => run.runId !== data.runId ? run : {
      ...run,
      members: run.members.some(member => member.seq === data.seq)
        ? run.members
        : [...run.members, {
          seq: data.seq, label: data.label,
          ...data.phase === undefined ? {} : { phase: data.phase },
          childId: data.childId,
        }],
    })
    return { ...doc, workflow: { runs } }
  }
  if (type === 'tool-workflow/agent-end') {
    const data = (event as { data: { runId: string; seq: number; outcome: 'completed' | 'failed' | 'cancelled' } }).data
    const runs = (doc.workflow?.runs ?? []).map(run => run.runId !== data.runId ? run : {
      ...run,
      members: run.members.map(member => member.seq !== data.seq ? member : { ...member, outcome: data.outcome }),
    })
    return { ...doc, workflow: { runs } }
  }
  if (type === 'tool-workflow/run-end') {
    const data = (event as { data: { runId: string; stopReason: 'completed' | 'cancelled' | 'error' } }).data
    const runs = (doc.workflow?.runs ?? []).map(run => run.runId !== data.runId ? run : { ...run, state: data.stopReason })
    const notice: NoticeEntry = {
      kind: 'notice', id: `workflow:${data.runId}:end`, text: `✓ workflow 结束 · ${data.stopReason}`, tone: 'info',
    }
    return { ...doc, workflow: { runs }, entries: [...doc.entries, notice] }
  }
  return undefined
}

/**
 * Fold one committed session event into the document.
 * Unknown events (the vocabulary widens with plugins) pass through unchanged.
 */
export function fold(event: SessionEvent, doc: ViewDocument): ViewDocument {
  // Workflow events live in the tool-workflow plugin's vocabulary (not part
  // of this package's dependency closure); fold them structurally first so
  // the typed switch below never sees them.
  const workflowDoc = foldWorkflow(event, doc)
  if (workflowDoc !== undefined) return workflowDoc
  switch (event.type) {
    case 'turn/start': {
      const status: StatusEntry = { kind: 'status', id: `turn:${event.data.turn}`, status: 'working', startedAt: event.time }
      return { entries: [...doc.entries, status], busy: true }
    }

    case 'turn/end': {
      const reason = event.data.reason
      const outcome: TurnOutcome | undefined = reason.kind === 'aborted'
        ? { text: '已中断', tone: 'info' }
        : reason.kind === 'error'
          ? { text: `Error: ${reason.error.code}: ${reason.error.message}`, tone: 'error' }
          : reason.kind === 'max-tokens'
            ? { text: '达到输出 token 上限', tone: 'info' }
            : reason.kind === 'blocked'
              ? { text: '被策略阻止', tone: 'info' }
              : undefined
      const entries = doc.entries.filter(entry => !(entry.kind === 'status' && (
        entry.id === `turn:${event.data.turn}` || entry.id.startsWith('retry:')
      )))
      if (outcome === undefined) return { entries, busy: false }
      // P0: the outcome badges the turn's last assistant message; a notice
      // row remains only when the turn produced no message at all (e.g. the
      // very first request already failed).
      const assistant = entries
        .filter(entry => entry.kind === 'assistant' && entry.turn === event.data.turn)
        .at(-1)
      if (assistant === undefined || assistant.kind !== 'assistant') {
        const notice: NoticeEntry = { kind: 'notice', id: `notice:${event.data.turn}`, text: outcome.text, tone: outcome.tone === 'error' ? 'error' : 'info' }
        return { entries: [...entries, notice], busy: false }
      }
      const withOutcome = updateById({ entries, busy: false }, assistant.id, entry => entry.kind === 'assistant'
        ? { ...entry, outcome }
        : entry)
      return withOutcome
    }

    case 'subagent/descriptor': {
      // A subagent child identifies itself in its own log: a single badge row
      // in the document flow (label from the durable descriptor). One-shot
      // children are terminal runs — the composer turns read-only (E10), so
      // a resumed child cannot be edited after the fact.
      const label = event.data.label
      const mode = event.data.mode
      const entry: NoticeEntry = {
        kind: 'notice', id: `subagent:${event.seq}`,
        text: label === undefined ? '◆ subagent 已启动' : `◆ subagent · ${label}`,
        tone: 'info',
      }
      const entries = [...doc.entries, entry]
      if (mode !== 'one-shot') return { ...doc, entries }
      return {
        ...doc,
        entries: [...entries, {
          kind: 'notice' as const, id: `subagent:readonly:${event.seq}`,
          text: '🔒 一次性子代理会话 · 只读',
          tone: 'info' as const,
        }],
        readOnlyHint: 'one-shot-subagent',
      }
    }

    case 'feedback/record': {
      const entry: NoticeEntry = {
        kind: 'notice', id: `feedback:${event.seq}`,
        text: `反馈：${event.data.text}`,
        tone: 'info',
      }
      return { ...doc, entries: [...doc.entries, entry] }
    }

    case 'step/start':
      return commitStreaming(doc)

    case 'user/message': {
      const text = joinTextBlocks(event.data.content)
      if (event.data.source.kind !== 'user') {
        // Injected context (workspace instructions, runtime snapshots, skill
        // catalogs, goal rounds) arrives as user-role messages with plugin
        // sources. The web shows them as expandable context rows; the TUI
        // renders one compact system row per injection (T1③) that expands
        // to the full body on Enter (E12).
        const source = event.data.source as { kind: string } & Record<string, unknown>
        const entry: NoticeEntry = {
          kind: 'notice', id: `inject:${event.seq}`,
          text: injectRowText(source, text),
          tone: 'info',
          detail: text,
        }
        return { ...doc, entries: [...doc.entries, entry] }
      }
      if (text === '') return doc
      const entry: UserEntry = { kind: 'user', id: `u${event.seq}`, seq: event.seq, at: event.time, text }
      return { ...doc, entries: [...doc.entries, entry] }
    }

    case 'assistant/chunk': {
      const chunk = event.data.chunk
      if (chunk.type === 'text-delta') {
        return chunk.text === '' ? doc : appendStreaming(doc, event.data.turn, event.data.step, chunk.text, '', event.time)
      }
      if (chunk.type === 'reasoning-delta') {
        return chunk.text === '' ? doc : appendStreaming(doc, event.data.turn, event.data.step, '', chunk.text, event.time)
      }
      // block-start/end, tool-call-delta, usage, finish: the assembled message
      // is authoritative, so deltas for other block kinds are skipped.
      return doc
    }

    case 'assistant/message': {
      const text = joinTextBlocks(event.data.message.content)
      // ContentBlockType is merge-extensible, so `type === 'reasoning'` does
      // not narrow; read the text field structurally.
      const thinking = event.data.message.content
        .filter(block => block.type === 'reasoning')
        .map(block => (block as { text?: string }).text ?? '')
      const id = `${event.data.turn}:${event.data.step}`
      if (text === '' && thinking.length === 0) return removeEntry(doc, id)
      const turnStatus = doc.entries.find((entry): entry is Extract<ViewEntry, { kind: 'status' }> => entry.kind === 'status' && entry.id === `turn:${event.data.turn}`)
      const startedAt = turnStatus?.startedAt
      const streaming = doc.entries.find(entry => entry.id === id && entry.kind === 'assistant')
      const firstChunkAt = streaming !== undefined && streaming.kind === 'assistant' ? streaming.firstChunkAt : undefined
      const outputTokens = event.data.usage?.outputTokens ?? 0
      let stats: AssistantStats | undefined
      if (startedAt !== undefined) {
        stats = { runMs: Math.max(0, event.time - startedAt), ttftMs: firstChunkAt === undefined ? 0 : Math.max(0, firstChunkAt - startedAt) }
        if (outputTokens > 0 && firstChunkAt !== undefined && event.time > firstChunkAt) {
          stats.tokensPerSecond = Math.round(outputTokens / ((event.time - firstChunkAt) / 1000) * 10) / 10
        }
      }
      const messageId = (event.data.message as { id?: string }).id
      const entry: AssistantEntry = {
        kind: 'assistant', id, turn: event.data.turn, step: event.data.step,
        seq: event.seq, at: event.time, ...messageId === undefined ? {} : { messageId },
        text, thinking, state: 'committed',
        ...stats === undefined ? {} : { stats },
        ...event.data.usage === undefined
          ? {}
          : {
              usage: {
                inputTokens: event.data.usage.inputTokens,
                outputTokens: event.data.usage.outputTokens,
                ...event.data.usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: event.data.usage.cacheReadTokens },
                ...event.data.usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: event.data.usage.cacheWriteTokens },
              },
            },
      }
      return upsert(doc, id, entry)
    }

    case 'tool/call': {
      const entry: ToolEntry = {
        kind: 'tool', id: event.data.callId, callId: event.data.callId,
        name: event.data.name, arguments: event.data.arguments, state: 'running',
        turn: event.data.turn, step: event.data.step, calledAt: event.time,
      }
      return { ...doc, entries: [...doc.entries, entry] }
    }

    case 'tool/result': {
      const block = event.data.message.content[0]
      const callId = block.toolCallId as string
      const output = { blocks: block.content as DshContentBlock[] }
      const patch: {
        state: 'done' | 'error'
        output: { blocks: DshContentBlock[] }
        error?: { name: string; code: string }
        meta?: JsonValue
      } = {
        state: event.data.error === undefined ? 'done' : 'error',
        output,
        ...event.data.error === undefined ? {} : { error: event.data.error },
        ...event.data.meta === undefined ? {} : { meta: event.data.meta },
      }
      const existing = doc.entries.find(entry => entry.kind === 'tool' && entry.callId === callId)
      if (existing === undefined) {
        // Result without a preceding call (seed truncation): keep the audit
        // trail visible rather than dropping the outcome.
        const entry: ToolEntry = { kind: 'tool', id: callId, callId, name: '?', arguments: '', ...patch }
        return { ...doc, entries: [...doc.entries, entry] }
      }
      return updateById(doc, callId, entry => entry.kind === 'tool'
        ? { ...entry, ...patch, ...entry.calledAt === undefined ? {} : { durationMs: Math.max(0, event.time - entry.calledAt) } }
        : entry)
    }

    // Nested sub-dispatches (B3): a `run_code` program calling tools emits
    // `tool/code-dispatch-start` (running child) then `tool/code-dispatch`
    // (settled child) with explicit parent/sub ids. Children fold into the
    // parent call's `children` tree (the web's ToolCallTree subCalls).
    case 'tool/code-dispatch-start': {
      const data = event.data as { parentCallId: string; subCallId: string; name: string; arguments?: unknown }
      const child: ToolEntry = {
        kind: 'tool', id: data.subCallId, callId: data.subCallId,
        name: data.name,
        arguments: data.arguments === undefined ? '' : JSON.stringify(data.arguments),
        state: 'running',
        calledAt: event.time,
      }
      return updateToolTree(doc, data.parentCallId, entry => ({
        ...entry,
        children: [...(entry.children ?? []), child],
      }))
    }

    case 'tool/code-dispatch': {
      const data = event.data as {
        parentCallId: string; subCallId: string; name: string; arguments?: unknown
        isError: boolean; content: unknown[]
      }
      const patch: {
        state: 'done' | 'error'
        output: { blocks: DshContentBlock[] }
      } = {
        state: data.isError ? 'error' : 'done',
        output: { blocks: data.content as DshContentBlock[] },
      }
      return updateToolTree(doc, data.subCallId, entry => ({
        ...entry,
        ...patch,
        ...entry.calledAt === undefined ? {} : { durationMs: Math.max(0, event.time - entry.calledAt) },
      }))
    }

    case 'compaction/summary': {
      const entry: StatusEntry = {
        kind: 'status', id: `compaction:${event.data.compactionId}`, status: 'compaction',
        detail: { summaryText: joinTextBlocks(event.data.summary), shadowedTokenCount: event.data.shadowedTokenCount },
      }
      return upsert(doc, entry.id, entry)
    }

    // The harness emits `llm/retry` (with `maxRetries`/`delayMs`) before the
    // backoff wait, then a sparse `llm/retry-started` once the wait elapsed
    // and the request is retried. Show the countdown from the first event
    // and keep the row (without a stale countdown) across retry-started.
    case 'llm/retry': {
      const data = event.data as {
        retryId: string; retry: number; maxRetries?: number; delayMs?: number
        failure?: { code: string; message: string }
      }
      const entry: StatusEntry = {
        kind: 'status', id: `retry:${data.retryId}`, status: 'retry',
        detail: {
          attempt: data.retry, maxAttempts: data.maxRetries ?? 0, delayMs: data.delayMs ?? 0,
          ...data.failure === undefined ? {} : { failure: data.failure },
        },
      }
      return upsert(doc, entry.id, entry)
    }

    case 'llm/retry-started': {
      const data = event.data as { retryId: string; retry: number }
      const existing = doc.entries.find((entry): entry is StatusEntry =>
        entry.kind === 'status' && entry.id === `retry:${data.retryId}`)
      const entry: StatusEntry = {
        kind: 'status', id: `retry:${data.retryId}`, status: 'retry',
        detail: {
          attempt: data.retry,
          // `llm/retry-started` carries no policy data; keep what the
          // preceding `llm/retry` showed, with the countdown elapsed.
          maxAttempts: existing?.detail !== undefined && 'maxAttempts' in existing.detail
            ? existing.detail.maxAttempts
            : 0,
          ...existing?.detail !== undefined && 'failure' in existing.detail && existing.detail.failure !== undefined
            ? { failure: existing.detail.failure }
            : {},
          delayMs: 0,
        },
      }
      return upsert(doc, entry.id, entry)
    }

    case 'approval/asked': {
      const entry: ApprovalEntry = {
        kind: 'approval', id: `approval:${event.data.id}`, toolName: event.data.toolName,
        ...event.data.callId === undefined ? {} : { callId: event.data.callId },
        ...event.data.reason === undefined ? {} : { reason: event.data.reason },
        state: 'pending',
      }
      return { ...doc, entries: [...doc.entries, entry] }
    }

    case 'approval/decided':
      return updateById(doc, `approval:${event.data.id}`, entry => entry.kind === 'approval'
        ? { ...entry, state: 'decided', outcome: event.data.outcome }
        : entry)

    case 'goal/change': {
      if (event.data.operation === 'clear') return removeEntry(doc, 'goal')
      const goal = event.data.goal
      const entry: GoalEntry = {
        kind: 'goal', id: 'goal', objective: String(goal.objective), phase: String(goal.phase),
        ...goal.blockedReason === undefined ? {} : { blockedReason: String(goal.blockedReason) },
        maxGoalRounds: goal.maxGoalRounds, roundsStarted: event.data.roundsStarted,
      }
      return upsert(doc, 'goal', entry)
    }

    case 'todo/write': {
      const entry: TodoEntry = {
        kind: 'todo', id: 'todo',
        items: event.data.todos.map(item => ({ content: item.content, status: item.status })),
      }
      return upsert(doc, 'todo', entry)
    }

    case 'session/title': {
      const entry: NoticeEntry = { kind: 'notice', id: `notice:title:${event.seq}`, text: `会话标题：${event.data.title}`, tone: 'info', group: 'title' }
      const withEntry = upsert(doc, entry.id, entry)
      return withEntry.title === event.data.title ? withEntry : { ...withEntry, title: event.data.title }
    }

    case 'permission/preset': {
      // 显示名与 footer/状态槽同口径（web PermissionSelect 变换），转录行
      // 保留审计语义但不再裸展示机器名。
      const entry: NoticeEntry = { kind: 'notice', id: `notice:preset:${event.seq}`, text: `权限预设：${permissionDisplayName(String(event.data.preset))}`, tone: 'info', group: 'preset' }
      // The preset also pins to the fixed status slot above the input line
      // (web parity: the composer area carries the session's preset chip);
      // the transcript row above stays for the audit trail.
      if (doc.permissionPreset === String(event.data.preset)) {
        return upsert(doc, entry.id, entry)
      }
      return { ...upsert(doc, entry.id, entry), permissionPreset: String(event.data.preset) }
      return { ...doc, entries: [...doc.entries, entry] }
    }

    case 'plan/mode': {
      const entry: NoticeEntry = {
        kind: 'notice', id: `notice:plan:${event.seq}`,
        text: event.data.active ? '进入 plan 模式（提案待审）' : '退出 plan 模式',
        tone: 'info',
        group: 'plan',
      }
      return { ...doc, entries: [...doc.entries, entry], planMode: event.data.active }
    }

    default:
      return doc
  }
}

/** Replay a whole event log (fresh session or resumed history) into one document. */
export function replay(events: readonly SessionEvent[]): ViewDocument {
  return events.reduce((doc, event) => fold(event, doc), emptyDocument())
}
