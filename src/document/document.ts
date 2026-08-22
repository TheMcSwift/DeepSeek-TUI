/**
 * The ViewDocument contract: the only stable interface between the DSH event
 * log and the pi view layer. Pure types and id rules — no cordis, no pi, no
 * terminal imports. See DESIGN.md §2.
 * @module dsh-tui-app/document
 */

/** Opaque DSH content block (text/reasoning/tool-call/tool-result/image). */
export interface DshContentBlock {
  type: string
  text?: string
  [key: string]: unknown
}

/** JSON-serializable value, as carried by `tool/result.meta`. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/**
 * Stable entry ids (the view layer reconciles exclusively on these):
 * - user       = `u${seq}`
 * - assistant  = `${turn}:${step}`
 * - tool       = callId
 * - status     = `turn:${n}` | `retry:${retryId}` | `compaction:${compactionId}`
 * - approval   = `approval:${approvalId}`
 * - goal/todo  = `goal` / `todo` (singleton entries, updated in place)
 */
export type EntryId = string

export interface UserEntry {
  kind: 'user'
  id: EntryId
  text: string
  /** Source event seq (fork anchor, T2⑤); set by the fold. */
  seq?: number
  /** Event wall-clock timestamp (T3① message clock). */
  at?: number
}

/** Per-message wall-time metrics folded from event timestamps (T1②). */
export interface AssistantStats {
  /** turn/start → assembled assistant/message wall time. */
  runMs: number
  /** turn/start → first text chunk wall time. */
  ttftMs: number
  /** Output tokens per decode second, when both halves are measurable. */
  tokensPerSecond?: number
}

/** How a turn ended, rendered as a badge on its assistant message (P0). */
export interface TurnOutcome {
  text: string
  tone: 'info' | 'error'
}

/** Streaming decode sample: wall-clock time plus the segment's char length
 *  (C1: live gauge while streaming, min-max sparkline after the turn;
 *  chars approximate tokens at ~4 chars/token for display only). */
export interface DecodeSample {
  t: number
  chars: number
}

export interface AssistantEntry {
  kind: 'assistant'
  id: EntryId
  turn: number
  step: number
  /** Source assistant/message event seq; set by the fold on commit. */
  seq?: number
  /** Durable message id the model-facing message carries (feedback target, T2②). */
  messageId?: string
  /** Event wall-clock timestamp (T3① message clock). */
  at?: number
  /** Authoritative visible text (text-delta concatenation, then the assembled message). */
  text: string
  /** Committed reasoning blocks; while streaming, one accumulating element. */
  thinking: string[]
  state: 'streaming' | 'committed'
  /** First text/reasoning chunk timestamp (internal streaming marker). */
  firstChunkAt?: number
  /** Streaming decode sample window (C1: gauge/sparkline; last 24 kept). */
  decodeSamples?: DecodeSample[]
  /** Wall-time metrics computed at assistant/message (T1②). */
  stats?: AssistantStats
  /** Token accounting from the assembled message, when reported (cache
   *  buckets drive the web-parity cache-hit stat). */
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number; cacheWriteTokens?: number }
  /** Turn ending (interrupt/error/token ceiling), attached at turn/end (P0). */
  outcome?: TurnOutcome
}

export interface ToolEntry {
  kind: 'tool'
  id: EntryId
  callId: string
  name: string
  /** Raw JSON arguments exactly as the model produced them. */
  arguments: string
  state: 'running' | 'done' | 'error'
  /** Owning turn/step (T4② produced-file attribution). */
  turn?: number
  step?: number
  /** tool/call timestamp (duration anchor, T3②). */
  calledAt?: number
  /** tool/call → tool/result wall time (T3②). */
  durationMs?: number
  output?: { blocks: DshContentBlock[] }
  error?: { name: string; code: string }
  /** Opaque tool metadata (FsDiffMeta lives here). */
  meta?: JsonValue
  /**
   * Nested sub-dispatches (B3): `tool/code-dispatch-start` children embedded
   * in their parent call, mirroring the web's `subCalls` tree. Children are
   * folded recursively; the doc's top-level `entries` hold roots only.
   */
  children?: ToolEntry[]
}

export interface RetryDetail {
  attempt: number
  maxAttempts: number
  delayMs: number
  /** Last failure reason (`llm/retry` `failure`), revealed on expand (A12). */
  failure?: { code: string; message: string }
}

export interface CompactionDetail {
  summaryText: string
  shadowedTokenCount: number
}

export interface StatusEntry {
  kind: 'status'
  id: EntryId
  status: 'working' | 'retry' | 'compaction'
  detail?: RetryDetail | CompactionDetail
  /** turn/start event timestamp (stats anchor for the turn's messages). */
  startedAt?: number
}

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

export interface ApprovalEntry {
  kind: 'approval'
  id: EntryId
  toolName: string
  callId?: string
  reason?: string
  state: 'pending' | 'decided'
  outcome?: ApprovalOutcome
}

export interface GoalEntry {
  kind: 'goal'
  id: 'goal'
  objective: string
  phase: string
  blockedReason?: string
  maxGoalRounds: number
  roundsStarted: number
}

export interface TodoEntry {
  kind: 'todo'
  id: 'todo'
  items: { content: string; status: string }[]
}

/** A single-line notice: system facts (title, preset switch, plan mode) and
 *  fallback turn outcomes (error with no message). */
export interface NoticeEntry {
  kind: 'notice'
  id: EntryId
  text: string
  tone: 'info' | 'error' | 'success'
  /** Convergence group; consecutive same-group notices render as one (P1). */
  group?: string
  /** Number of merged notices when the view converged the group (P1). */
  count?: number
  /** Full body for expandable notices (injected context rows, E12). */
  detail?: string
}

export type ViewEntry =
  | UserEntry
  | AssistantEntry
  | ToolEntry
  | StatusEntry
  | ApprovalEntry
  | GoalEntry
  | TodoEntry
  | NoticeEntry

export interface ViewDocument {
  /** Ordered entries; append-only except in-place updates (tool/status/approval/goal/todo). */
  entries: ViewEntry[]
  /**
   * The composer is read-only (E10): set when the session's own
   * `subagent/descriptor` marks it one-shot — a terminal child run that
   * cannot be edited after the fact.
   */
  readOnlyHint?: string
  /** A turn is active: composer disabled, Esc interrupts, working status shows. */
  busy: boolean
  /** Latest generated session title (session/title event), when any. */
  title?: string
  /** Plan mode is active (plan/mode event). */
  planMode?: boolean
  /** The session's permission preset (permission/preset event), shown in the
   *  fixed status slot above the input line. */
  permissionPreset?: string
  /** Workflow runs (E15/H32): tool-workflow events folded into the panel. */
  workflow?: WorkflowView
}

/** One workflow member (agent) of a run (web ui-workflow-run member). */
export interface WorkflowMemberView {
  /** Member sequence within the run (agent-start seq). */
  seq: number
  label: string
  /** Optional phase group label (agent-start `phase`). */
  phase?: string
  /** The member's child session id. */
  childId: string
  /** Settled outcome; absent while the member runs. */
  outcome?: 'completed' | 'failed' | 'cancelled'
}

/** One top-level workflow run (web ui-workflow-run run → member). */
export interface WorkflowRunView {
  runId: string
  name: string
  state: 'running' | 'completed' | 'cancelled' | 'error'
  members: WorkflowMemberView[]
}

/** The panel's workflow projection: runs in start order. */
export interface WorkflowView {
  runs: WorkflowRunView[]
}

/** The empty starting document. */
/** Plain-text transcript for scrollback persistence on quit (pi's
 * `fullscreenExitOutput: 'transcript'` parity). */
export function transcriptText(doc: ViewDocument): string {
  const lines: string[] = []
  for (const entry of doc.entries) {
    switch (entry.kind) {
      case 'user':
        lines.push(...entry.text.split('\n').map(line => `❯ ${line}`))
        break
      case 'assistant':
        if (entry.text !== '') lines.push(...entry.text.split('\n'))
        break
      case 'tool': {
        lines.push(`$ ${entry.name} ${entry.arguments}`)
        const output = entry.output?.blocks
          .filter(block => block.type === 'text' && typeof block.text === 'string')
          .map(block => block.text as string)
          .join('\n') ?? ''
        if (output !== '') lines.push(...output.split('\n'))
        break
      }
      case 'notice':
        lines.push(`· ${entry.text}`)
        break
      case 'approval':
        lines.push(`· approval ${entry.toolName} → ${entry.outcome ?? entry.state}`)
        break
      default:
        break
    }
  }
  return lines.join('\n')
}

export function emptyDocument(): ViewDocument {
  return { entries: [], busy: false, title: undefined, planMode: undefined }
}

/** Concatenate visible text blocks; reasoning and other blocks stay hidden. */
export function joinTextBlocks(content: readonly { type: string; text?: string }[]): string {
  let text = ''
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') text += block.text
  }
  return text
}
