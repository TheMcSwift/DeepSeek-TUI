/**
 * `dsh-tui-app` — the interactive terminal surface over dsh-base. The runner
 * creates one Agent through the core registry (or resumes a persisted
 * session), folds committed session events through the pure reducer into the
 * chat view, and delegates terminal lifecycle to a {@link TerminalApp}
 * (pi-tui by default, a fake in tests).
 * @module dsh-tui-app
 */

import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { skillCommands, SKILL_COMMAND_PREFIX } from './skill-catalog.ts'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, SessionStore } from '@deepseek-ai/dsh-session'
// Empty type imports carry the loader Context merge for the settlement await,
// the cmdline Context merge, and the session-query Context merge.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-jobs'
import { PiTuiApp } from './app/pi-tui-app.ts'
import { applyPalette } from './app/pi/color.ts'
import { detectThemeLive, resolveThemeVariant } from './app/pi/theme-detect.ts'
import { installApprovals } from './control/approvals.ts'
import { emptyDocument, transcriptText } from './document/document.ts'
import { resolveLanguage, setStrings, strings } from './view/strings.ts'
import { fold, replay } from './projection/fold.ts'
import type { ViewDocument } from './document/document.ts'

/** One persisted reply rating (TUI-owned sidecar; the web keeps its own store). */
interface FeedbackRecord {
  sessionId: string
  messageId: string
  rating: 'positive' | 'negative'
  note?: string
  at: number
}

/** The TUI feedback sidecar lives next to the composer history (T2②). */
function feedbackFile(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'tui-feedback.json')
}

function readFeedback(): FeedbackRecord[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(feedbackFile(), 'utf8'))
    return Array.isArray(parsed) ? parsed as FeedbackRecord[] : []
  } catch {
    return []
  }
}

function writeFeedback(records: FeedbackRecord[]): void {
  try {
    mkdirSync(dirname(feedbackFile()), { recursive: true })
    writeFileSync(feedbackFile(), JSON.stringify(records, null, 2) + '\n')
  } catch {
    // A read-only home must not break the surface.
  }
}

/**
 * Rate the transcript's latest assistant reply (T2②). The service-backed
 * messageFeedback stack needs the web profile's storage plugins, which an
 * out-of-tree profile cannot mount (the loader resolves bundle rows only from
 * the dsh installation, see GAP-ANALYSIS.md) — so the TUI persists its own
 * sidecar and shows the summary on replay.
 */
async function rateLastReply(app: TerminalApp, session: Session, doc: ViewDocument): Promise<ViewDocument> {
  // T3④: a focused assistant message is the target; otherwise the latest.
  const focusedId = app.focusedEntryId()
  const focused = focusedId === null ? undefined : doc.entries.find(entry => entry.id === focusedId)
  const last = focused !== undefined && focused.kind === 'assistant'
    ? focused
    : [...doc.entries].reverse().find(entry => entry.kind === 'assistant')
  if (last === undefined || last.kind !== 'assistant' || last.messageId === undefined) {
    await app.askDialog({ title: '没有可评价的回复', options: ['好'] })
    return doc
  }
  const answer = await app.askDialog({ title: '评价最近回复', options: [`👍 ${strings().feedbackLike}`, `👎 ${strings().feedbackDislike}`] })
  if (answer.reason !== 'picked' || answer.picked === undefined) return doc
  const rating: FeedbackRecord['rating'] = answer.picked.startsWith('👍') ? 'positive' : 'negative'
  let note: string | undefined
  if (rating === 'negative') {
    const detail = await app.askDialog({ title: strings().feedbackNote, options: [] })
    if (detail.reason === 'picked' && detail.picked !== undefined && detail.picked.trim() !== '') {
      note = detail.picked.trim()
    }
  }
  const records = readFeedback().filter(record => !(record.sessionId === session.id && record.messageId === last.messageId))
  records.push({ sessionId: session.id, messageId: last.messageId, rating, ...note === undefined ? {} : { note }, at: Date.now() })
  writeFeedback(records)
  const mark = rating === 'positive' ? '👍' : '👎'
  app.toast(`已记录反馈 ${mark}`, 'success')
  return doc
}

/** Replay summary: one row listing this session's persisted ratings (T2②). */
function feedbackSummary(sessionId: string): { positive: number; negative: number } {
  const mine = readFeedback().filter(record => record.sessionId === sessionId)
  let positive = 0
  let negative = 0
  for (const record of mine) {
    if (record.rating === 'positive') positive++
    else negative++
  }
  return { positive, negative }
}

/** Human-friendly age for the session picker (T3⑤). */
function relTime(at: number): string {
  const minute = 60_000
  const hour = 3_600_000
  const day = 86_400_000
  const delta = Date.now() - at
  if (delta < minute) return '刚刚'
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`
  if (delta < 7 * day) return `${Math.floor(delta / day)} 天前`
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Flush the session and reveal its durable jsonl artifact path (T1⑦). */
async function exportSessionLog(ctx: Context, sessions: SessionStore, session: Session, doc: ViewDocument): Promise<ViewDocument> {
  await sessions.flush(session)
  const location = ctx.get('sessionPersistence')?.locate(session.header)
  const text = location?.path !== undefined
    ? `会话日志已导出（jsonl）：${location.path}`
    : `会话日志已 flush；jsonl 位于 DSH_HOME 会话目录（session ${session.id}）`
  return {
    ...doc,
    entries: [...doc.entries, { kind: 'notice' as const, id: `notice:export:${session.id}`, text, tone: 'info' as const }],
  }
}
import type { SurfaceMeta, TerminalApp, TerminalAppHandlers } from './app/terminal-app.ts'

/** Stable Cordis plugin name. */
export const name = 'tui-runner'

/** Core services required before an agent can be created or resumed. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config: the invocation flags mapped from the startup provider service. */
export interface Config {
  /** Persisted session id to resume, when given (`__latest__` = most recent). */
  resume?: string
  /** Model override as `provider/model`, when given. */
  model?: string
  /** Working directory for a fresh agent, when given. */
  workspace?: string
  /** Open the session picker right after boot (T5⑦). */
  browse?: boolean
  /** Skip persisting the session on quit (T5⑦). */
  noSession?: boolean
}

/** Surface factory seam; tests replace it with a fake. */
export const internals: {
  createApp: () => TerminalApp
  /** Whether stdin/stdout are a usable interactive terminal. */
  isTty: () => boolean
  /** Settle window between the two quit/swap flushes (tests shorten it). */
  flushSettleMs: number
  /** Sink for the transcript dump printed on quit (tests capture it). */
  writeStdout: (text: string) => void
} = {
  flushSettleMs: 400,
  writeStdout: (text: string) => { process.stdout.write(text) },
  createApp: () => {
    // Language resolves before any view is built: DSH_TUI_LANG=en picks the
    // English dictionary, default zh (T9 i18n).
    setStrings(resolveLanguage(process.env.DSH_TUI_LANG))
    // DSH_TUI_THEME=light|dark wins; =auto probes the terminal background
    // through OSC 11 (best-effort, dark fallback); the default stays dark —
    // probing stdin before the TUI owns the terminal races the raw-mode
    // handover (proven by an E2E hang), so it is an explicit opt-in (T5③).
    applyPalette(resolveThemeVariant(process.env.DSH_TUI_THEME, detectThemeLive))
    return new PiTuiApp({
      historyFile: join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'tui-history.json'),
    })
  },
  isTty: () => Boolean(process.stdout.isTTY && process.stdin.isTTY),
}

/** Resolve the `provider/model` override against the composition default. */
function resolveSelection(override: string | undefined, fallback: ModelSelection): ModelSelection {
  if (override === undefined) return fallback
  const slash = override.indexOf('/')
  if (slash <= 0 || slash === override.length - 1) {
    throw new Error(`dsh tui: --model must be 'provider/model', got ${JSON.stringify(override)}`)
  }
  return { provider: override.slice(0, slash), model: override.slice(slash + 1) }
}

/** Report an unexpected runner failure and request a failing exit. */
function fail(exit: (code: number) => void, error: unknown): void {
  process.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
  exit(1)
}

/**
 * Mount the interactive terminal runner.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated invocation config.
 */
export function apply(ctx: Context, config: Config): void {
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('tui-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  void run(ctx, config, exit).catch((error: unknown) => { fail(exit, error) })
}

/** The whole interactive session: boot the agent, wire events, drive the surface. */
async function run(ctx: Context, config: Config, exit: (code: number) => void): Promise<void> {
  // Loader siblings mount concurrently. Await the complete application before
  // creating an Agent so its scoped tools and adapters are not half-composed.
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  // Early process shutdown can dispose the tree while boot is pending.
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return

  const selection = resolveSelection(config.model, defaultModel.currentSelection())
  // The surface needs a real terminal; refuse pipes and CI shells with a
  // pointer to the headless profile instead of half-rendering into them.
  if (!internals.isTty()) {
    process.stderr.write('dsh tui: this surface needs an interactive terminal; use `dsh --profile headless` for non-interactive runs\n')
    exit(1)
    return
  }
  const app = internals.createApp()
  let doc = emptyDocument()
  let cmdSeq = 0
  let handle: AgentHandle | undefined
  let currentSessionId = ''
  let quitting = false
  const meta: SurfaceMeta = {
    model: `${selection.provider}/${selection.model}`,
    session: '',
    workspace: resolve(config.workspace ?? '.'),
  }

  const modelRef: ModelSelectionRef = { current: selection, assembled: undefined }
  /** Runtime workspace override (Ctrl+W); boot resolves it into meta.cwd. */
  const workspaceRef: { current: string | undefined } = { current: undefined }
  const setup = (agentCtx: Context): void => {
    installModelSelection(agentCtx, modelRef)
  }

  /** Create or resume the active agent and replay its history into the view. */
  const boot = async (resumeId: string | undefined): Promise<void> => {
    // -c/--continue: resolve the most recent session at boot time (T5⑦).
    if (resumeId === '__latest__') {
      const query = ctx.get('sessionQuery')
      if (query !== undefined) {
        const records = await query.listSessions().catch(() => [])
        records.sort((left, right) => right.header.createdAt - left.header.createdAt)
        resumeId = records[0]?.header.id
      }
      if (resumeId === '__latest__') resumeId = undefined
    }
    // Read the live selection so a model picked mid-session applies to the
    // next session swap.
    const current = modelRef.current ?? selection
    const created = resumeId === undefined
      ? await agents.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        meta: { cwd: resolve(workspaceRef.current ?? config.workspace ?? '.') },
        agentOptions: { provider: current.provider, model: current.model },
        setup,
      })
      : await agents.resume({
        resumeSessionId: SessionId(resumeId),
        agentOptions: { provider: current.provider, model: current.model },
        setup,
      })
    handle = created
    currentSessionId = created.agent.session.id
    meta.session = currentSessionId
    meta.parentSession = created.agent.session.header.parentSession
    // Adapter-reported context window drives the footer's ctx % (best effort).
    void ctx.get('llm')?.resolveModelInfo?.(current.provider, current.model).then((info) => {
      meta.contextWindow = info?.context?.contextWindow
    }).catch(() => {})
    // Drop the previous session's views before replaying the next history.
    app.reset()
    doc = replay(created.agent.session.events)
    // Persisted reply ratings surface as one summary row (T2②).
    const ratings = feedbackSummary(currentSessionId)
    if (ratings.positive + ratings.negative > 0) {
      doc = { ...doc, entries: [{
        kind: 'notice' as const, id: 'notice:feedback-summary',
        text: `已记录反馈：👍 ${ratings.positive} · 👎 ${ratings.negative}`,
        tone: 'info' as const,
      }, ...doc.entries] }
    }
    app.render(doc)
  }

  // Subscribe before the first turn can commit: every event of the active
  // session folds through the projection into a render. The listener rides
  // the runner's fiber, so tree disposal removes it automatically.
  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    if (session.id !== currentSessionId) return
    doc = fold(event, doc)
    if (process.env.DSH_TUI_DEBUG !== undefined) {
      process.stderr.write(`dsh tui event: ${event.type} seq=${event.seq} busy=${String(doc.busy)}\n`)
    }
    app.render(doc)
    // Queue drain: one pending message per settled turn, in FIFO order.
    // Never drain while quitting: /quit with a pending queue discards it.
    if (!quitting && !doc.busy && queue.length > 0 && handle !== undefined) {
      const next = queue.shift()
      if (next !== undefined) {
        app.notifyQueue(queue.length)
        handle.agent.followup(createUserMessage({
          content: [{ type: 'text', text: next }],
          source: { kind: 'user' },
        }))
      }
    }
  })

  const quit = async (): Promise<void> => {
    const debug = (step: string): void => {
      if (process.env.DSH_TUI_DEBUG !== undefined) process.stderr.write(`dsh tui debug: ${step}\n`)
    }
    if (handle !== undefined) {
      debug('quit: awaiting idle')
      await handle.agent.whenIdle()
      if (!config.noSession) {
        debug('quit: idle reached, flushing')
        await flushSettled(handle.agent.session)
        debug('quit: flushed, disposing')
      } else {
        debug('quit: idle reached, skipping flush (--no-session)')
      }
      await handle.dispose()
      debug('quit: disposed')
      handle = undefined
    }
    app.stop()
    debug('quit: app stopped, exiting')
    // Leave the conversation in the terminal scrollback (pi's
    // `fullscreenExitOutput: 'transcript'` parity): after the alt screen
    // restores, print the plain transcript once.
    if (doc.entries.length > 0) {
      internals.writeStdout(`\n${transcriptText(doc)}\n`)
    }
    exit(0)
    // The launcher's natural-completion path sets process.exitCode and relies
    // on the event loop draining. Some spawn chains (pnpm's sh wrapper) leave
    // a parent-watch handle behind that never drains, so force the exit after
    // a short grace — the session was already flushed and the agent disposed.
    setTimeout(() => { process.exit(0) }, 2_000).unref()
  }

  /**
   * Flush, then settle briefly and flush again: trailing post-turn commits
   * (session title, audits) can land after `whenIdle`, and a single flush
   * would persist a truncated log (observed E2E flake).
   */
  const flushSettled = async (session: Session): Promise<void> => {
    await sessions.flush(session)
    await new Promise<void>(resolve => setTimeout(resolve, internals.flushSettleMs))
    await sessions.flush(session)
  }

  const swap = async (nextId: string | undefined): Promise<void> => {
    if (handle === undefined) return
    await handle.agent.whenIdle()
    await flushSettled(handle.agent.session)
    await handle.dispose()
    await boot(nextId)
  }

  // Messages entered while a turn runs queue here and drain FIFO at each
  // turn end (the web's Enter-as-Queue semantics, T1⑤).
  const queue: string[] = []
  const MAX_QUEUE = 10

  /**
   * Fork the current session at `seq` (T2①) and swap the surface to the child.
   * `fallbackLast` falls back to the last completed turn when the anchor finds
   * none — the host's omitted-atSeq `/clone` semantics (T5⑦).
   */
  const forkSession = async (session: Session, seq: number, fallbackLast: boolean, label: string): Promise<void> => {
    const events = session.events
    const boundary = events.find(event => event.type === 'turn/end' && event.seq >= seq)
      ?? (fallbackLast ? events.findLast(event => event.type === 'turn/end') : undefined)
    if (boundary === undefined) {
      doc = { ...doc, entries: [...doc.entries, {
        kind: 'notice' as const, id: `notice:fork:${cmdSeq++}`,
        text: '该消息所在轮次尚未完成，无法分支', tone: 'error' as const,
      }] }
      app.render(doc)
      return
    }
    let cut = events.indexOf(boundary) + 1
    // Extend through trailing out-of-band appends up to the next turn/start
    // (mirrors the host fork: balanced seed, inherited title).
    while (cut < events.length && events[cut]?.type !== 'turn/start') cut++
    await handle!.agent.whenIdle()
    await sessions.flush(session)
    const childId = `session-${randomUUID()}` as SessionId
    const child = await agents.create({
      sessionId: childId,
      seed: events.slice(0, cut),
      meta: {
        ...session.header.cwd === undefined ? {} : { cwd: session.header.cwd },
        parentSession: session.id,
        seedLength: cut,
      },
      agentOptions: { provider: (modelRef.current ?? selection).provider, model: (modelRef.current ?? selection).model },
      setup,
    })
    await handle!.dispose()
    handle = child
    currentSessionId = childId
    meta.session = childId
    meta.parentSession = child.agent.session.header.parentSession
    app.reset()
    doc = replay(child.agent.session.events)
    doc = { ...doc, entries: [...doc.entries, {
      kind: 'notice' as const, id: `notice:fork:${cmdSeq++}`,
      text: `${label}（种子 ${cut} 个事件）`, tone: 'info' as const,
    }] }
    app.render(doc)
  }

  /** The full command catalog: registered commands plus TUI-native specials. */
  const commandCatalog = (agent: Agent): Array<{ value: string; label: string; description?: string }> => {
    const commands = ctx.get('commands')
    const items = (commands === undefined ? [] : commands.list(agent)).map(descriptor => ({
      value: descriptor.name,
      label: `/${descriptor.name}${descriptor.input === undefined ? '' : ` ${descriptor.input.hint}`}`,
      description: descriptor.description,
    }))
    const push = (value: string, label: string, description: string): void => {
      if (!items.some(item => item.value === value)) items.push({ value, label, description })
    }
    // The web's /export rides a browser-only download plugin; the TUI ships
    // native equivalents for the browser-specific commands.
    push('__export', '/export · 导出会话日志', 'flush 并显示会话 jsonl 路径')
    push('__rate', '/rate · 评价最近回复', '👍/👎 最近一条助手回复（可选备注）')
    push('__new', '/new · 新会话', '原地开启新会话')
    push('__quit', '/quit · 退出 TUI', 'flush 会话并退出')
    push('__help', '/hotkeys · 快捷键', '全部快捷键一览')
    push('__clone', '/clone · 复制当前会话', '以最后完成的轮次为种子开新会话')
    push('__effort', '/effort · 推理强度', '单独选择当前模型的 reasoning effort')
    push('__lang', '/lang · 语言', '切换界面语言 zh/en')
    push('__rename', '/rename · 重命名会话', '固定会话标题（替代自动生成）')
    push('__queue', '/queue · 查看队列', '列出排队消息：取回或删除（E1）')
    return items
  }

  /** Untyped seam: the skill registry lives in the host composition; the
   *  out-of-tree profile reads it structurally (no dsh-skill import). */
  const skillsService = (): { list: () => Promise<unknown[]> } | undefined =>
    (ctx as { get: (key: string) => unknown }).get('skills') as { list: () => Promise<unknown[]> } | undefined

  /** The live slash catalog: runtime commands + native extras + skills
   *  (G22/H33); the registry listing is async, so skills land via setCommands
   *  the moment they resolve. */
  const refreshSkillCatalog = async (agent: Agent): Promise<Array<{ value: string; label: string; description?: string }>> => {
    const items = commandCatalog(agent)
    const skills = skillsService()
    if (skills === undefined) return items
    const rows = await Promise.resolve(skills.list()).catch(() => [])
    if (Array.isArray(rows)) items.push(...skillCommands(rows as never))
    return items
  }

  const handlers: TerminalAppHandlers = {
    onInput: (text: string): void => {
      if (quitting || handle === undefined) return
      if (doc.readOnlyHint !== undefined) {
        // E10: a one-shot subagent child is a terminal run — no edits after
        // the fact. Slash commands still work (you can leave the session).
        app.toast('🔒 一次性子代理会话为只读，无法发送消息', 'error')
        return
      }
      if (doc.busy || queue.length > 0) {
        if (queue.length < MAX_QUEUE) {
          queue.push(text)
          app.notifyQueue(queue.length)
        }
        return
      }
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }))
    },
    onInterrupt: (): void => { handle?.agent.cancel({ kind: 'user' }) },
    onQuit: (): void => {
      if (quitting) return
      quitting = true
      void quit().catch((error: unknown) => { fail(exit, error) })
    },
    onSessionPicked: (value: string | null): void => {
      if (value === null || value === currentSessionId) return
      void swap(value).catch((error: unknown) => { fail(exit, error) })
    },
    onModelPicked: (value: string | null): void => {
      if (value === null) return
      // Model and reasoning effort are chosen independently: picking a model
      // keeps the current effort; `/effort` switches it separately (T7).
      const next: ModelSelection = resolveSelection(value, selection)
      modelRef.current = next
      void defaultModel.saveSelection(next).catch(() => {})
    },
    onSessionPickerRequest: (): void => {
      const query = ctx.get('sessionQuery')
      if (query === undefined) return
      void query.listSessions().then(async (records) => {
        const items = await Promise.all(records.map(async (record) => {
          const title = await query.readTitle(record.header.id).catch(() => undefined)
          // Subagent child sessions indent under their parent (T1⑥).
          const label = `${record.header.parentSession === undefined ? '' : '↳ '}${title?.title ?? record.header.id}`
          return {
            value: record.header.id,
            label,
            description: `${record.persisted ? 'persisted' : 'live'} · ${relTime(record.header.createdAt)}`,
          }
        }))
        if (!quitting) app.showSessionPicker(items)
      }).catch((error: unknown) => {
        process.stderr.write(`dsh tui: session listing failed: ${error instanceof Error ? error.message : String(error)}\n`)
      })
    },
    onSessionSearchRequest: (filter: string): void => {
      // H5: backend full-text session search merged into the open picker.
      const query = ctx.get('sessionQuery')
      if (query === undefined || handle === undefined) return
      const trimmed = filter.trim()
      if (trimmed === '') return // the picker still holds the full list
      void query.searchSessions({ query: trimmed, limit: 20 }).then(async (page) => {
        const items = await Promise.all(page.items.map(async (hit) => {
          const title = await query.readTitle(hit.header.id).catch(() => undefined)
          const label = `${hit.header.parentSession === undefined ? '' : '↳ '}${title?.title ?? hit.header.id}`
          const snippet = hit.bestMatch.snippet.replace(/\s+/g, ' ').trim()
          const preview = snippet.length > 60 ? `${snippet.slice(0, 59)}…` : snippet
          return {
            value: hit.header.id,
            label,
            description: preview === '' ? `persisted · ${relTime(hit.header.createdAt)}` : `${preview} · ${relTime(hit.header.createdAt)}`,
          }
        }))
        if (!quitting) app.setSessionPickerRows(items)
      }).catch(() => {})
    },
    onNewSessionRequest: (): void => {
      if (quitting) return
      void swap(undefined).catch((error: unknown) => { fail(exit, error) })
    },
    onCommandPickerRequest: (): void => {
      const commands = ctx.get('commands')
      const agent = handle?.agent
      if (commands === undefined || agent === undefined) return
      void refreshSkillCatalog(agent).then((items) => {
        app.setCommands(items)
        if (!quitting) app.showCommandPicker(items)
      }).catch((error: unknown) => {
        process.stderr.write(`dsh tui: command catalog failed: ${error instanceof Error ? error.message : String(error)}\n`)
      })
    },
    onCommandPicked: (name: string | null, rawInput?: string): void => {
      if (name === null || handle === undefined) return
      // A skill pick inserts its name into the composer (web /-menu semantics).
      if (name.startsWith(SKILL_COMMAND_PREFIX)) {
        app.restoreToEditor(name.slice(SKILL_COMMAND_PREFIX.length))
        return
      }
      if (name === '__lang') {
        void (async () => {
          const answer = await app.askDialog({ title: strings().chooseLanguage, options: ['中文', 'English'] })
          if (answer.reason !== 'picked' || answer.picked === undefined) return
          setStrings(answer.picked === 'English' ? 'en' : 'zh')
          app.toast(answer.picked === 'English' ? 'Language: English' : '语言：中文', 'success')
          app.render(doc)
        })().catch((error: unknown) => { fail(exit, error) })
        return
      }
      if (name === '__effort') {
        const current = modelRef.current ?? selection
        const llm = ctx.get('llm')
        void (async () => {
          const info = await llm?.resolveModelInfo?.(current.provider, current.model).catch(() => undefined)
          const efforts = info?.reasoning?.efforts
          if (efforts === undefined || efforts.length === 0) {
            doc = { ...doc, entries: [...doc.entries, {
              kind: 'notice' as const, id: `notice:cmd:${cmdSeq++}`,
              text: `当前模型不支持${strings().effort}选择`, tone: 'error' as const,
            }] }
            app.render(doc)
            return
          }
          const answer = await app.askDialog({
            title: strings().effort,
            options: efforts.map(item => `${item.name}${current.reasoningEffort === item.id ? '（当前）' : ''}`),
          })
          if (answer.reason !== 'picked' || answer.picked === undefined) return
          const picked = efforts.find(item => answer.picked!.startsWith(item.name))
          if (picked === undefined) return
          const next: ModelSelection = { ...current, reasoningEffort: picked.id }
          modelRef.current = next
          void defaultModel.saveSelection(next).catch(() => {})
          app.toast(`${strings().effort}：${picked.name}`, 'success')
          app.render(doc)
        })().catch((error: unknown) => { fail(exit, error) })
        return
      }
      if (name === '__clone') {
        if (handle === undefined) return
        const session = handle.agent.session
        const lastSeq = session.events.at(-1)?.seq ?? -1
        void forkSession(session, lastSeq, true, '已复制当前会话').catch((error: unknown) => { fail(exit, error) })
        return
      }
      if (name === '__help') {
        void app.askDialog({
          title: strings().hotkeysTitle,
          detail: strings().hotkeysDetail,
          options: ['好'],
        }).then(() => {})
        return
      }
      if (name === '__new') {
        if (!quitting) void swap(undefined).catch((error: unknown) => { fail(exit, error) })
        return
      }
      if (name === '__quit') {
        if (quitting) return
        quitting = true
        void quit().catch((error: unknown) => { fail(exit, error) })
        return
      }
      if (name === '__rate') {
        void rateLastReply(app, handle.agent.session, doc).then((next) => {
          doc = next
          app.render(doc)
        }).catch((error: unknown) => { process.stderr.write(`dsh tui: feedback failed: ${error instanceof Error ? error.message : String(error)}\n`) })
        return
      }
      if (name === '__export') {
        void exportSessionLog(ctx, sessions, handle.agent.session, doc).then((next) => {
          doc = next
          app.render(doc)
        }).catch((error: unknown) => { process.stderr.write(`dsh tui: export failed: ${error instanceof Error ? error.message : String(error)}\n`) })
        return
      }
      if (name === '__rename') {
        // H7: pin the session title (automatic generation stops). Inline
        // args ride the slash line; a bare `/rename` asks for the title.
        const title = rawInput?.trim() ?? ''
        void (async () => {
          let finalTitle = title
          if (finalTitle === '') {
            const answer = await app.askDialog({ title: '会话标题', options: [] })
            if (answer.reason !== 'picked' || answer.picked === undefined) return
            finalTitle = answer.picked.trim()
          }
          if (finalTitle === '') return
          const titleService = ctx.get('sessionTitle')
          if (titleService === undefined) {
            app.toast('会话重命名不可用（sessionTitle 服务未挂载）', 'error')
            return
          }
          try {
            const snapshot = (titleService as { rename: (session: unknown, title: string) => { title: string } })
              .rename(handle.agent.session, finalTitle)
            doc = { ...doc, title: snapshot.title }
            app.render(doc)
            app.toast(`会话标题：${snapshot.title}`, 'success')
          } catch (error: unknown) {
            app.toast(`重命名失败：${error instanceof Error ? error.message : String(error)}`, 'error')
          }
        })()
        return
      }
      if (name === '__queue') {
        // E1: the queued messages dock — list the pending queue, then pick
        // one item to retrieve (Alt+Up parity) or delete.
        if (queue.length === 0) {
          app.toast('队列为空', 'info')
          return
        }
        const label = (text: string): string => text.length > 56 ? `${text.slice(0, 55)}…` : text
        const items = queue.map((text, index) => ({
          value: String(index),
          label: `${index + 1}. ${label(text)}`,
          description: '',
        }))
        app.showQueuePicker(items, (value: string | null) => {
          if (value === null) return
          const index = Number(value)
          void (async () => {
            const answer = await app.askDialog({ title: '队列项操作', options: ['取回到输入框', '删除'] })
            if (answer.reason !== 'picked' || answer.picked === undefined) return
            const item = queue.splice(index, 1)[0]
            if (item === undefined) return
            app.notifyQueue(queue.length)
            if (answer.picked === '删除') {
              app.toast('已删除队列项', 'success')
            } else {
              app.restoreToEditor(item)
            }
          })()
        })
        return
      }
      const commands = ctx.get('commands')
      const agent = handle.agent
      if (commands === undefined) return
      const descriptor = commands.list(agent).find(item => item.name === name)
      void (async () => {
        // Inline args ride the slash line (`/name args`, cc/pi style); the
        // dialog fallback covers palette picks for commands with input hints.
        let args = rawInput ?? ''
        if (descriptor === undefined) {
          doc = { ...doc, entries: [...doc.entries, {
            kind: 'notice' as const, id: `notice:cmd:${cmdSeq++}`,
            text: `未知命令：/${name}`, tone: 'error' as const,
          }] }
          app.render(doc)
          return
        }
        if (descriptor.input !== undefined && args === '') {
          const answer = await app.askDialog({ title: `/${name} ${descriptor.input.hint}`, options: [] })
          if (answer.reason !== 'picked' || answer.picked === undefined) return
          args = answer.picked
        }
        const execution = await commands.execute(agent, `/${name} ${args}`.trimEnd(), new AbortController().signal)
        const result = execution?.result
        const text = result === undefined || result.text === undefined || result.text === ''
          ? `/${name} 已执行`
          : result.text
        // P2: confirmations are transient toasts; only failures stay in the
        // transcript as an audit row.
        if (result?.kind === 'error') {
          doc = { ...doc, entries: [...doc.entries, {
            kind: 'notice' as const, id: `notice:cmd:${cmdSeq++}`,
            text, tone: 'error' as const,
          }] }
        } else {
          app.toast(text, 'success')
        }
        app.render(doc)
      })().catch((error: unknown) => { fail(exit, error) })
    },
    onExitPlanModeRequest: (): void => {
      const commands = ctx.get('commands')
      const agent = handle?.agent
      if (commands === undefined || agent === undefined || !doc.planMode) return
      void commands.execute(agent, '/plan off', new AbortController().signal).catch(() => {})
    },
    onShellResult: (text: string, hidden: boolean): void => {
      if (handle === undefined) return
      if (!hidden) {
        handlers.onInput(text)
        return
      }
      const firstLine = text.split('\n')[0] ?? text
      const lines = text.split('\n').length - 1
      doc = { ...doc, entries: [...doc.entries, {
        kind: 'notice' as const, id: `notice:shell:${cmdSeq++}`,
        text: `⚙ ${firstLine} 已执行 · ${lines} 行输出（未发送给模型）`,
        tone: 'info' as const,
      }] }
      app.render(doc)
    },
    onSteerRequest: (text: string): void => {
      if (quitting || handle === undefined) return
      if (doc.readOnlyHint !== undefined) {
        // E10: steer lands inside the running turn too — the read-only
        // one-shot child must not accept it any more than a queued message.
        app.toast('🔒 一次性子代理会话为只读，无法发送消息', 'error')
        return
      }
      if (doc.busy) {
        // Steering lands inside the running turn (agent.steer, pi parity).
        handle.agent.steer(createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: 'user' },
        }))
      } else {
        handlers.onInput(text)
      }
    },
    onQueueRetrieveRequest: (): void => {
      const text = queue.pop()
      if (text === undefined) return
      app.notifyQueue(queue.length)
      app.restoreToEditor(text)
    },
    onRateRequest: (): void => {
      if (handle === undefined) return
      void rateLastReply(app, handle.agent.session, doc).then((next) => {
        doc = next
        app.render(doc)
      }).catch((error: unknown) => { fail(exit, error) })
    },
    onForkPickerRequest: (): void => {
      if (handle === undefined) return
      // Fork points: every committed user/assistant message. The boundary is
      // the first turn/end at-or-after the picked seq (web `atSeq` semantics),
      // so forking at a reply keeps its whole turn.
      const points = doc.entries
        .filter((entry): entry is Extract<typeof entry, { kind: 'user' } | { kind: 'assistant' }> =>
          entry.kind === 'user' || (entry.kind === 'assistant' && entry.state === 'committed' && entry.seq !== undefined))
        .map((entry) => {
          const seq = entry.kind === 'user' ? entry.seq ?? Number(entry.id.slice(1)) : entry.seq ?? Number(entry.id.slice(1))
          const preview = entry.text.split('\n')[0] ?? ''
          return {
            value: String(seq),
            label: preview.length <= 40 ? preview : `${preview.slice(0, 39)}…`,
            description: `${entry.kind === 'assistant' ? 'assistant' : 'user'} · seq ${seq}`,
          }
        })
      if (points.length === 0) {
        void app.askDialog({ title: '没有可分支的消息', options: ['好'] }).then(() => {})
        return
      }
      if (!quitting) app.showForkPicker(points)
    },
    onForkPicked: (seq: number | null): void => {
      if (seq === null || handle === undefined) return
      void forkSession(handle.agent.session, seq, false, `已从 seq ${seq} 分支新会话`).catch((error: unknown) => { fail(exit, error) })
    },
    onWorkspaceSwitchRequest: (): void => {
      if (quitting) return
      void (async () => {
        const answer = await app.askDialog({ title: '切换到工作目录（绝对路径）', options: [] })
        if (answer.reason !== 'picked' || answer.picked === undefined || answer.picked.trim() === '') return
        const path = resolve(answer.picked.trim())
        try {
          if (!statSync(path).isDirectory()) throw new Error('not a directory')
        } catch {
          doc = { ...doc, entries: [...doc.entries, {
            kind: 'notice' as const, id: `notice:workspace:${cmdSeq++}`,
            text: `目录不存在或不可用：${path}`, tone: 'error' as const,
          }] }
          app.render(doc)
          return
        }
        workspaceRef.current = path
        meta.workspace = path
        app.setWorkspace(path)
        void swap(undefined).catch((error: unknown) => { fail(exit, error) })
      })().catch((error: unknown) => { fail(exit, error) })
    },
    onPermissionPickerRequest: (): void => {
      const presets = ctx.get('permissionPresets')
      if (presets === undefined || handle === undefined) return
      const current = presets.current(handle.agent.session.events)
      const items = presets.names.map((name) => {
        const option = presets.optionOf(name)
        return { value: name, label: option.name, description: option.description, current: name === current }
      })
      if (!quitting) app.showPermissionPicker(items)
    },
    onPermissionPicked: (value: string | null): void => {
      if (value === null || handle === undefined) return
      const presets = ctx.get('permissionPresets')
      if (presets === undefined) return
      // The web confirms before enabling Full access; reuse its copy (T8).
      if (value.includes('full-access') && presets.current(handle.agent.session.events) !== value) {
        void (async () => {
          const answer = await app.askDialog({
            title: strings().fullAccessConfirmTitle,
            detail: strings().fullAccessConfirmDescription,
            options: [strings().fullAccessAcknowledge, strings().cancel],
            icon: '⚠',
          })
          if (answer.reason === 'picked' && answer.picked === strings().fullAccessAcknowledge) {
            presets.set(handle!.agent.session, value)
          }
        })().catch((error: unknown) => { fail(exit, error) })
        return
      }
      presets.set(handle.agent.session, value)
    },
    onModelPickerRequest: (): void => {
      const llm = ctx.get('llm')
      if (llm === undefined) return
      void Promise.all(llm.listProviders().map(async (provider) => {
        const models = await llm.listModels(provider.id).catch(() => [])
        return models.map(model => ({
          value: `${model.provider}/${model.id}`,
          label: model.name || model.id,
          description: provider.name,
        }))
      })).then((groups) => {
        if (!quitting) app.showModelPicker(groups.flat())
      }).catch((error: unknown) => {
        process.stderr.write(`dsh tui: model listing failed: ${error instanceof Error ? error.message : String(error)}\n`)
      })
    },
  }

  // A tree-level shutdown (SIGINT/SIGTERM through the launcher) must restore
  // the terminal even though quit() never runs.
  ctx.effect(() => () => { app.stop() })

  await boot(config.resume)
  app.start(handlers, meta)
  const dbg = (msg: string): void => { process.stderr.write(`dsh tui: ${msg}\n`) }
  // The inline slash menu filters a live catalog (Ctrl+/ refreshes it too);
  // skills/change events re-sync it when providers load later.
  if (handle !== undefined) {
    // Seed the slash catalog synchronously: native commands (`/quit`, `/new`,
    // …) and registered runtime commands must resolve immediately, or a
    // `/quit` typed before the async skills scan settles would fall back to
    // the raw name and never run (observed on `--resume`: the E2E types
    // `/quit` right after the replay, while `skills.list()` is still
    // scanning; the resolution then degraded to an unknown command and the
    // process never exited). Skills land via the async merge below.
    app.setCommands(commandCatalog(handle.agent))
    void refreshSkillCatalog(handle.agent).then(items => {
      if (handle !== undefined && !quitting) app.setCommands(items)
    }).catch(() => {})
  }
  ;(ctx as { on: (event: string, cb: () => void) => void }).on('skills/change', () => {
    if (handle !== undefined && !quitting) {
      void refreshSkillCatalog(handle.agent).then(items => { app.setCommands(items) }).catch(() => {})
    }
  })
  if (config.browse === true) handlers.onSessionPickerRequest?.()
  // Interactive answerer seams for tool permissions and agent questions.
  installApprovals(ctx, { present: question => app.askDialog(question) }, () => currentSessionId)

  // Background jobs (subagent one-shots) surface as live rows (T1⑥).
  const jobs = ctx.get('jobs')
  const refreshJobs = (): void => {
    if (jobs === undefined || handle === undefined) return
    const rows = jobs.list(handle.agent)
      .filter(job => job.ownerSession === undefined || job.ownerSession === currentSessionId)
      .map(job => ({
        id: job.id, label: job.label, status: job.status,
        ...job.startedAt === undefined ? {} : { startedAt: job.startedAt },
        ...job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt },
      }))
    app.showJobs(rows)
  }
  jobs?.onJobsChanged(() => refreshJobs())
  refreshJobs()
}
