/**
 * The TUI runner over the real core registries with a scripted Agent factory
 * and a fake terminal app: agent creation/resume wiring, session-event → view
 * folding, busy gating, interrupt, and the flush-before-exit contract.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, AgentOptions, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import { apply, internals } from '../src/index.ts'
import { piTuiInternals } from '../src/app/pi-tui-app.ts'
import { setStrings } from '../src/view/strings.ts'
import type { Config } from '../src/index.ts'
import { emptyDocument } from '../src/document/document.ts'
import { FakeApp } from './helpers/fake-app.ts'

const originalInternals = { ...internals }
let capturedStdout = ''
afterEach(() => {
  internals.createApp = originalInternals.createApp
  internals.isTty = originalInternals.isTty
  internals.flushSettleMs = originalInternals.flushSettleMs
  internals.writeStdout = originalInternals.writeStdout
  internals.forceExitMs = originalInternals.forceExitMs
  internals.forceExit = originalInternals.forceExit
  capturedStdout = ''
})
// (Re-applied inside bench(): afterEach restores the real stdout writer.)
// Tests run under millisecond clocks: bench() re-applies a zero settle
// window (afterEach restores the production 400ms between tests).

interface Script {
  before?(session: Session): void
  afterPrompt?(session: Session, message: UserMessage): Promise<void> | void
  /** Seed the resumed session's log before publication (called inside the factory). */
  seedResumed?(session: Session): void
}

/**
 * 仿真 settings 服务：支持 tui 命名空间注册（M2 持久化路径）与内存持久化。
 * register 返回注册 scope 的最小面（get/watch），installSettingsSection 即用即走。
 */
function fakeSettingsService(
  section: Record<string, unknown> = {},
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    documentPath: '/home/u/.dsh/settings.yaml',
    get: (ns: string) => (ns === 'tui' ? { ...section } : undefined),
    update: async (ns: string, patch: Record<string, unknown>) => {
      if (ns === 'tui') Object.assign(section, patch)
    },
    register: (_ns: string, _schema: unknown, options?: { base?: Record<string, unknown> }) => ({
      get: () => ({ ...(options?.base ?? {}), ...section }),
      watch: () => {},
    }),
    ...overrides,
  }
}

/** Append one scripted assistant turn: user message, chunk, assembled message, close. */
function appendTurn(session: Session, turn: number, message: UserMessage, text: string): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  if (text !== '') {
    session.append('assistant/chunk', { turn, step: 1, chunk: { type: 'text-delta', index: 0, text } })
  }
  session.append('assistant/message', {
    turn, step: 1,
    message: createAssistantMessage({
      content: text === '' ? [] : [{ type: 'text', text }],
      source: { provider: 'test-provider', model: 'test-model' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

interface Bench {
  ctx: Context
  app: FakeApp
  started: Promise<void>
  created: CreateAgentOptions[]
  resumed: ResumeAgentOptions[]
  followups: UserMessage[]
  steers: UserMessage[]
  cancels: { count: number }
  order: string[]
  exitCode: Promise<number>
}

/** Mount the real registries around a small scripted Agent factory. */
async function bench(
  script: Script,
  config: Config,
  provide?: (ctx: Context) => void,
  options: { tty?: boolean } = {},
): Promise<Bench> {
  internals.flushSettleMs = 0
  internals.writeStdout = (text: string) => { capturedStdout += text }
  // quit 路径会 arm 一枚强制退出 timer；测试里必须收敛成 no-op，否则它会在
  // 2s 后把 vitest worker exit 掉（整套单测非 0 退出）。
  internals.forceExit = () => {}
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'test-provider', model: 'test-model' })
  provide?.(ctx)
  const created: CreateAgentOptions[] = []
  const resumed: ResumeAgentOptions[] = []
  const followups: UserMessage[] = []
  const steers: UserMessage[] = []
  const cancels = { count: 0 }

  function mintAgent(ownerCtx: Context, session: Session, options: { agentOptions?: AgentOptions }): AgentHandle {
    let idle = Promise.resolve()
    const agent = {} as Agent
    const agentCtx = ownerCtx.extend({ agent })
    Object.assign(agent, {
      id: session.id,
      options: options.agentOptions ?? {},
      session,
      inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
      status: 'idle',
      ctx: agentCtx,
      cancel: () => { cancels.count++ },
      runMaintenance: () => Promise.reject(new Error('not used')),
      send: () => {},
      followup: (message: UserMessage) => {
        followups.push(message)
        agent.inbox.append('next-turn', message)
        idle = Promise.resolve().then(async () => { await script.afterPrompt?.(session, message) })
      },
      steer: (message: UserMessage) => { steers.push(message) },
      inject: () => {},
      whenIdle: () => idle,
    } satisfies Partial<Agent>)
    return { agent, dispose: () => Promise.resolve() }
  }

  ctx.agents.setFactory({
    async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
      created.push(options)
      const session = ctx.sessions.create(options.sessionId, {
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      const handle = mintAgent(ownerCtx, session, options)
      await options.setup?.(handle.agent.ctx)
      script.before?.(session)
      ctx.agents.register(handle.agent)
      return handle
    },
    async resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle> {
      resumed.push(options)
      const session = ctx.sessions.create(options.resumeSessionId, {})
      script.seedResumed?.(session)
      const handle = mintAgent(ownerCtx, session, options)
      await options.setup?.(handle.agent.ctx)
      ctx.agents.register(handle.agent)
      return handle
    },
  })
  const app = new FakeApp()
  internals.createApp = () => app
  internals.isTty = () => options.tty ?? true
  const order: string[] = []
  ctx.on('session/flush', () => { order.push('flush') })
  const exitCode = new Promise<number>((resolve) => {
    ctx.provide('appExit', (code: number) => { order.push('exit'); resolve(code) })
  })
  apply(ctx, config)
  return { ctx, app, started: app.started, created, resumed, followups, steers, cancels, order, exitCode }
}

/** Let pending microtasks (scripted turn work) settle. */
function settle(ms = 0): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('tui runner', () => {
  it('creates a fresh agent with the default model and renders initial and scripted states', async () => {
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 1, message, 'final answer') },
    }, {})
    await test.started
    expect(test.created).toHaveLength(1)
    expect(test.created[0].agentOptions).toEqual({ provider: 'test-provider', model: 'test-model' })
    expect(test.app.meta?.model).toBe('test-provider/test-model')
    expect(test.app.meta?.session).toBe(test.created[0].sessionId)
    expect(test.app.rendered[0]).toEqual(emptyDocument())

    test.app.input('hello agent')
    await settle()
    expect(test.followups).toHaveLength(1)
    const final = test.app.last
    expect(final.entries.filter(entry => 'text' in entry).map(entry => entry.text)).toEqual(['hello agent', 'final answer'])
    expect(final.busy).toBe(false)
    await test.ctx.fiber.dispose()
  })

  it('overrides the model from a provider/model config value', async () => {
    const test = await bench({}, { model: 'pi-ai/deepseek-v4' })
    await test.started
    expect(test.created[0].agentOptions).toEqual({ provider: 'pi-ai', model: 'deepseek-v4' })
    await test.ctx.fiber.dispose()
  })

  it('fails the invocation on a model override without a provider', async () => {
    const test = await bench({}, { model: 'deepseek-v4' })
    expect(await test.exitCode).toBe(1)
    await test.ctx.fiber.dispose()
  })

  it('resumes a persisted session and replays its history into the first render', async () => {
    const test = await bench({
      seedResumed(session) {
        const message = {
          role: 'user', content: [{ type: 'text', text: 'earlier question' }], source: { kind: 'user' }, id: 'u-old',
        } as UserMessage
        appendTurn(session, 1, message, 'earlier answer')
      },
    }, { resume: 'session-abc' })
    await test.started
    expect(test.resumed).toHaveLength(1)
    expect(test.resumed[0].resumeSessionId).toBe('session-abc')
    expect(test.app.rendered[0].entries.filter(entry => 'text' in entry).map(entry => entry.text)).toEqual(['earlier question', 'earlier answer'])
    await test.ctx.fiber.dispose()
  })

  it('ignores events from other sessions', async () => {
    const test = await bench({}, {})
    await test.started
    const foreign = test.ctx.sessions.create('session-foreign' as never)
    foreign.append('turn/start', { turn: 1 })
    const count = test.app.rendered.length
    foreign.append('user/message', {
      role: 'user', content: [{ type: 'text', text: 'noise' }], source: { kind: 'user' }, id: 'u-noise',
    } as UserMessage, { surfaceOp: 'append' })
    expect(test.app.rendered.length).toBe(count)
    await test.ctx.fiber.dispose()
  })

  it('gates input while a turn is busy', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
        // leave the turn open: busy stays true
      },
    }, {})
    await test.started
    test.app.input('first')
    await settle()
    expect(test.followups).toHaveLength(1)
    test.app.input('second while busy')
    expect(test.followups).toHaveLength(1)
    await test.ctx.fiber.dispose()
  })

  it('queues messages entered while busy and drains them FIFO at turn ends', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
      },
    }, {})
    await test.started
    test.app.input('first')
    await settle()
    expect(test.followups).toHaveLength(1)
    test.app.input('second')
    test.app.input('third')
    await settle()
    expect(test.followups).toHaveLength(1) // busy: both queued
    expect(test.app.queues).toEqual([1, 2])
    // 排队内容随通知下传：busy 状态行显示队首预览。
    expect(test.app.queuedMessages.at(-1)).toEqual(['second', 'third'])
    const session = test.ctx.sessions.list()[0]
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await settle()
    expect(test.followups).toHaveLength(2) // FIFO: one drained
    expect(test.followups[1].content[0]).toEqual({ type: 'text', text: 'second' })
    expect(test.app.queues).toEqual([1, 2, 1])
    session.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    await settle()
    expect(test.followups).toHaveLength(3)
    expect(test.followups[2].content[0]).toEqual({ type: 'text', text: 'third' })
    expect(test.app.queues).toEqual([1, 2, 1, 0])
    await test.ctx.fiber.dispose()
  })

  it('interrupts the current turn through agent.cancel', async () => {
    const test = await bench({}, {})
    await test.started
    test.app.handlers?.onInterrupt()
    expect(test.cancels.count).toBe(1)
    await test.ctx.fiber.dispose()
  })

  it('flushes, stops the terminal, and exits 0 on quit', async () => {
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 1, message, 'final answer') },
    }, {})
    await test.started
    test.app.input('bye')
    await settle()
    test.app.handlers?.onQuit()
    expect(await test.exitCode).toBe(0)
    expect(test.app.stopped).toBe(1)
    expect(test.order).toEqual(['flush', 'flush', 'exit'])
    // The transcript lands in the scrollback on quit (pi parity).
    expect(capturedStdout).toContain('❯ bye')
    await test.ctx.fiber.dispose()
  })

  it('opens the session picker with the persisted sessions from sessionQuery', async () => {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('sessionQuery', {
        listSessions: async () => [
          { header: { version: 1, id: 'session-old' as never, createdAt: 1_000, cwd: '/tmp' }, live: false, persisted: true },
          { header: { version: 1, id: 'session-new' as never, createdAt: 2_000, cwd: '/tmp', parentSession: 'session-old' as never }, live: false, persisted: true },
        ],
        readTitle: async () => undefined,
      })
    })
    await test.started
    test.app.handlers?.onSessionPickerRequest?.()
    await settle()
    expect(test.app.sessions?.map(item => item.value)).toEqual(['session-old', 'session-new'])
    expect(test.app.sessions?.[0].label).toBe('session-old')
    // Relative time replaces the raw ISO timestamp (T3⑤).
    expect(test.app.sessions?.[0].description).toBe('persisted · 1970-01-01')
    // Subagent child sessions indent under their parent (T1⑥).
    expect(test.app.sessions?.[1].label).toBe('↳ session-new')
    await test.ctx.fiber.dispose()
  })

  it('reports background jobs and refreshes on the change event', async () => {
    let listener: (() => void) | undefined
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('jobs', {
        list: () => [
          { id: 'job-1', kind: 'subagent', label: 'audit repo', status: 'running', ownerSession: undefined },
          { id: 'job-2', kind: 'subagent', label: 'foreign', status: 'running', ownerSession: 'other-session' },
        ],
        onJobsChanged: (l: () => void) => { listener = l },
      } as never)
    })
    await test.started
    await settle()
    expect(test.app.jobs[0].map(job => job.label)).toEqual(['audit repo'])
    // Live refresh path.
    listener?.()
    await settle()
    expect(test.app.jobs).toHaveLength(2)
    await test.ctx.fiber.dispose()
  })

  it('swaps to the picked session through resume', async () => {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('sessionQuery', { listSessions: async () => [], readTitle: async () => undefined })
    })
    await test.started
    expect(test.app.resets).toBe(1) // the initial boot reset
    test.app.handlers?.onSessionPicked('session-old')
    await settle(150) // swap now double-flushes with a settle window
    expect(test.resumed).toHaveLength(1)
    expect(test.resumed[0].resumeSessionId).toBe('session-old')
    expect(test.app.resets).toBe(2) // the swap reset
    expect(test.app.meta?.session).toBe('session-old')
    // CC-09: 切换成功后 toast 即时反馈。
    expect(test.app.toasts.some(toast => toast.text.includes('已恢复会话'))).toBe(true)
    await test.ctx.fiber.dispose()
  })

  it('exits 1 with a pointer when no TTY is available', async () => {
    const test = await bench({}, {}, undefined, { tty: false })
    expect(await test.exitCode).toBe(1)
    expect(test.app.rendered).toHaveLength(0)
    await test.ctx.fiber.dispose()
  })

  it('starts a fresh session on the /new request', async () => {
    const test = await bench({}, {})
    await test.started
    const firstSession = test.app.meta?.session
    expect(test.created).toHaveLength(1)
    test.app.handlers?.onNewSessionRequest?.()
    await settle(150)
    expect(test.created).toHaveLength(2)
    expect(test.app.resets).toBe(2)
    expect(test.app.meta?.session).not.toBe(firstSession)
    await test.ctx.fiber.dispose()
  })

  it('opens the trajectory view over the raw event log (B11/H31)', async () => {
    const test = await bench({
      afterPrompt: (session, message) => { appendTurn(session, 1, message, 'hi there') },
    }, {})
    await test.started
    test.app.input('hello')
    await settle(100)
    test.app.handlers?.onTrajectoryRequest?.()
    expect(test.app.trajectoryRows).toHaveLength(1)
    const rows = test.app.trajectoryRows[0]
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some(row => row.type === 'turn/start')).toBe(true)
    expect(rows.some(row => row.type === 'user/message' && row.summary.includes('hello'))).toBe(true)
    expect(rows.some(row => row.type === 'assistant/message' && row.summary.includes('hi there'))).toBe(true)
    expect(rows.every(row => row.seq >= 0 && row.at > 0 && row.summary !== '')).toBe(true)
    await test.ctx.fiber.dispose()
  })

  it('switches the hotkey preset via /keymap and persists it', async () => {
    // persistKeymap 写 $DSH_HOME/tui-keymap.txt——测试期间隔离到临时目录。
    const home = mkdtempSync(join(tmpdir(), 'dsh-tui-keymap-home-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const test = await bench({}, {})
      await test.started
      test.app.handlers?.onCommandPicked('__keymap', 'pi')
      await settle()
      expect(test.app.keymaps).toEqual(['pi'])
      expect(test.app.toasts.some(toast => toast.text.includes('快捷键预设已切换：pi'))).toBe(true)
      expect(readFileSync(join(home, 'tui-keymap.txt'), 'utf8').trim()).toBe('pi')
      // 未知预设值报错提示。
      test.app.handlers?.onCommandPicked('__keymap', 'vim')
      await settle()
      expect(test.app.toasts.some(toast => toast.tone === 'error' && toast.text.includes('未知快捷键预设'))).toBe(true)
      await test.ctx.fiber.dispose()
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('switches the visual theme via /theme and persists it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-tui-theme-home-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const test = await bench({}, {})
      await test.started
      test.app.handlers?.onCommandPicked('__theme', 'opencode')
      await settle()
      expect(test.app.themeRefreshes).toBe(1)
      expect(test.app.toasts.some(toast => toast.text.includes('视觉主题已切换：opencode'))).toBe(true)
      expect(readFileSync(join(home, 'tui-theme-preset.txt'), 'utf8').trim()).toBe('opencode')
      // 未知值报错。
      test.app.handlers?.onCommandPicked('__theme', 'tokyonight')
      await settle()
      expect(test.app.toasts.some(toast => toast.tone === 'error' && toast.text.includes('未知视觉主题'))).toBe(true)
      await test.ctx.fiber.dispose()
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('switches keymap + theme together via /preset', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-tui-preset-home-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const test = await bench({}, {})
      await test.started
      test.app.handlers?.onCommandPicked('__preset', 'opencode')
      await settle()
      expect(test.app.keymaps).toEqual(['opencode'])
      expect(test.app.themeRefreshes).toBe(1)
      expect(test.app.toasts.some(toast => toast.text.includes('预设已切换：opencode'))).toBe(true)
      expect(readFileSync(join(home, 'tui-keymap.txt'), 'utf8').trim()).toBe('opencode')
      expect(readFileSync(join(home, 'tui-theme-preset.txt'), 'utf8').trim()).toBe('opencode')
      await test.ctx.fiber.dispose()
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('opens the /settings panel with live values (M2)', async () => {
    // 隔离 DSH_HOME：主题/键位 sidecar 的默认值不受开发者本机状态影响。
    const home = mkdtempSync(join(tmpdir(), 'dsh-tui-settings-live-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const test = await bench({}, {})
      await test.started
      test.app.handlers?.onCommandPicked('__settings', '')
      await settle(150)
      expect(test.app.settingsShown).toHaveLength(1)
      const rows = test.app.settingsShown[0]
      expect(rows.map(row => row.key)).toContain('语言')
      expect(rows.map(row => row.key)).toContain('主题')
      expect(rows.map(row => row.key)).toContain('Enter 行为')
      expect(rows.map(row => row.key)).toContain('快捷键预设')
      expect(rows.map(row => row.key)).toContain('动画')
      expect(rows.map(row => row.key)).toContain('配置文件')
      const themeRow = rows.find(row => row.key === '主题')
      expect(themeRow?.current).toContain('web') // 默认主题预设
      await test.ctx.fiber.dispose()
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('switches Enter behavior from the /settings panel and persists it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-tui-settings-home-'))
    const previousHome = process.env.DSH_HOME
    const previousEnter = process.env.DSH_TUI_ENTER
    process.env.DSH_HOME = home
    try {
      const test = await bench({}, {})
      await test.started
      test.app.handlers?.onCommandPicked('__settings', '')
      await settle(150)
      test.app.handlers?.onSettingsRowPicked?.(2)
      await settle(50)
      // Enter 行为行现在是带 ● 当前标记的单列 picker。
      const rows = test.app.queueRows[test.app.queueRows.length - 1]
      expect(rows[0].current).toBe(true) // 默认 queue 是当前项
      test.app.queuePicked?.('steer')
      await settle(150)
      expect(process.env.DSH_TUI_ENTER).toBe('steer')
      expect(test.app.toasts.some(toast => toast.text.includes('Enter 行为'))).toBe(true)
      await test.ctx.fiber.dispose()
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      if (previousEnter === undefined) delete process.env.DSH_TUI_ENTER
      else process.env.DSH_TUI_ENTER = previousEnter
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('writes Enter 行为/动画 into the registered tui namespace and hydrates them on boot (M2)', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-tui-settings-persist-'))
    const previousHome = process.env.DSH_HOME
    const previousEnter = process.env.DSH_TUI_ENTER
    const previousAnim = process.env.DSH_TUI_ANIM
    const previousFrameMs = piTuiInternals.animFrameMs
    process.env.DSH_HOME = home
    try {
      const section: Record<string, unknown> = {}
      const patches: Array<[string, Record<string, unknown>]> = []
      // 第一次运行：切换必须落到 settings 服务的 tui 命名空间（注册后写入不再被拒）。
      const test = await bench({}, {}, (ctx) => {
        ctx.provide('settings', fakeSettingsService(section, {
          update: async (ns: string, patch: Record<string, unknown>) => {
            patches.push([ns, patch])
            Object.assign(section, patch)
          },
        }))
      })
      await test.started
      expect(patches).toEqual([]) // 启动只读不写
      test.app.handlers?.onCommandPicked('__settings', '')
      await settle(150)
      test.app.handlers?.onSettingsRowPicked?.(2)
      await settle(50)
      test.app.queuePicked?.('steer')
      await settle(150)
      expect(patches).toEqual([['tui', { enterBehavior: 'steer' }]])
      test.app.handlers?.onSettingsRowPicked?.(4)
      await settle(50)
      test.app.queuePicked?.('off')
      await settle(150)
      expect(patches).toEqual([['tui', { enterBehavior: 'steer' }], ['tui', { anim: 'off' }]])
      expect(section).toEqual({ enterBehavior: 'steer', anim: 'off' })
      await test.ctx.fiber.dispose()
      piTuiInternals.animFrameMs = 60 // 复位：第二次运行的 0 只能来自 settings 回填

      // 第二次运行：settings.yaml 里的 tui 段回填 env/internals（重启恢复）。
      delete process.env.DSH_TUI_ENTER
      delete process.env.DSH_TUI_ANIM
      const second = await bench({}, {}, (ctx) => {
        ctx.provide('settings', fakeSettingsService(section))
      })
      await second.started
      expect(process.env.DSH_TUI_ENTER).toBe('steer')
      expect(piTuiInternals.animFrameMs).toBe(0) // anim off 回填：动画关闭
      await second.ctx.fiber.dispose()
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      if (previousEnter === undefined) delete process.env.DSH_TUI_ENTER
      else process.env.DSH_TUI_ENTER = previousEnter
      if (previousAnim === undefined) delete process.env.DSH_TUI_ANIM
      else process.env.DSH_TUI_ANIM = previousAnim
      piTuiInternals.animFrameMs = previousFrameMs
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('switches the theme from the /settings panel and refreshes rows in place', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-tui-settings-theme-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const test = await bench({}, {})
      await test.started
      test.app.handlers?.onCommandPicked('__settings', '')
      await settle(150)
      test.app.handlers?.onSettingsRowPicked?.(1)
      await settle(50)
      // 主题四选带 ● 当前标记（默认 web）。
      const rows = test.app.queueRows[test.app.queueRows.length - 1]
      expect(rows[0].current).toBe(true)
      expect(rows[0].value).toBe('web')
      test.app.queuePicked?.('opencode')
      await settle(150)
      expect(test.app.themeRefreshes).toBe(1)
      // 行就地刷新：主题现状值已更新为 opencode。
      const last = test.app.settingsShown[test.app.settingsShown.length - 1]
      expect(last.find(row => row.key === '主题')?.current).toContain('opencode')
      await test.ctx.fiber.dispose()
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('opens the /plugins capability inventory with command/skill/projection rows (M3)', async () => {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('commands', {
        list: () => [
          { name: 'goal', description: 'Set the session goal' },
          { name: 'compact', description: 'Compact the transcript' },
        ],
        execute: async () => ({ commandId: 'c1', result: { kind: 'success' as const } }),
      } as never)
      ctx.provide('skills', { list: async () => [{ name: 'audit', description: 'run a supply-chain audit', invocation: { userInvocable: true } }] } as never)
      ctx.provide('sessionProjections', {
        snapshot: () => ({
          asOfSeq: 0,
          values: {
            permissions: { currentValue: 'workspace-write', options: [{ value: 'workspace-write', name: 'workspace-write' }] },
            contextBreakdown: { systemTokens: 1, toolsTokens: 2, messageTokens: 3 },
          },
        }),
      } as never)
    })
    await test.started
    test.app.handlers?.onCommandPicked('__plugins', '')
    await settle(150)
    expect(test.app.pluginsShown).toHaveLength(1)
    const rows = test.app.pluginsShown[0]
    const items = rows.filter((row): row is Extract<(typeof rows)[number], { kind: 'item' }> => row.kind === 'item')
    expect(items.map(item => item.action)).toContain('command:goal')
    expect(items.map(item => item.action)).toContain('skill:audit')
    expect(items.map(item => item.action)).toContain('projection:permissions')
    expect(items.find(item => item.action === 'projection:contextBreakdown')?.detail).toContain('结构化投影')
    // 命令行 → 执行；技能行 → 插入 composer；投影行 → 枚举 picker。
    test.app.handlers?.onPluginsRowPicked?.('command:goal')
    await settle()
    expect(test.app.catalogs.flat().some(item => item.value === 'goal')).toBe(true)
    test.app.handlers?.onPluginsRowPicked?.('skill:audit')
    await settle()
    expect(test.app.restored).toEqual(['audit'])
    test.app.handlers?.onPluginsRowPicked?.('projection:permissions')
    await settle(150)
    expect(test.app.permissions?.map(item => item.value)).toEqual(['workspace-write'])
    await test.ctx.fiber.dispose()
  })

  it('lists recent workspace directories and switches on pick (M4)', async () => {
    const tmp1 = mkdtempSync(join(tmpdir(), 'dsh-tui-ws-old-'))
    const tmp2 = mkdtempSync(join(tmpdir(), 'dsh-tui-ws-new-'))
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('sessionQuery', {
        listSessions: async () => [
          { header: { version: 1, id: 's1' as never, createdAt: 1000, cwd: tmp1 }, live: false, persisted: true },
          { header: { version: 1, id: 's2' as never, createdAt: 9000, cwd: tmp2 }, live: false, persisted: true },
          { header: { version: 1, id: 's3' as never, createdAt: 8000, cwd: tmp2 }, live: false, persisted: true },
        ],
        readTitle: async () => undefined,
      })
    })
    try {
      await test.started
      test.app.handlers?.onCommandPicked('__workspace', '')
      await settle(150)
      expect(test.app.queueRows).toHaveLength(1)
      const rows = test.app.queueRows[0]
      expect(rows[0].label).toContain(tmp2) // 最近优先
      expect(rows[0].description).toBe('2 个会话') // cwd 去重合并
      expect(rows.some(row => row.label.includes(tmp1))).toBe(true)
      const picked = test.app.queuePicked
      expect(picked).toBeDefined()
      picked?.(tmp2)
      await settle(150)
      expect(test.app.workspaces).toContain(tmp2)
      await test.ctx.fiber.dispose()
    } finally {
      rmSync(tmp1, { recursive: true, force: true })
      rmSync(tmp2, { recursive: true, force: true })
    }
  })

  it('opens the session picker from the /resume command', async () => {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('sessionQuery', {
        listSessions: async () => [
          { header: { version: 1, id: 's-resume' as never, createdAt: Date.now() - 30_000, cwd: '/tmp' }, live: false, persisted: true },
        ],
        readTitle: async () => ({ title: '上一轮对话' }),
      })
    })
    await test.started
    test.app.handlers?.onCommandPicked('__resume', '')
    await settle(150)
    // 面板立即以短 id 占位打开（标题回填不阻塞面板——几百个会话时逐个
    // 读完整日志会卡住打开路径）。
    expect(test.app.sessions).toEqual([
      { value: 's-resume', label: 's-resume', description: 'persisted · 刚刚' },
    ])
    await settle(50)
    // 标题限流回填后一次性就地刷新。
    expect(test.app.sessionPickerRows.at(-1)?.[0]?.label).toBe('上一轮对话')
    await test.ctx.fiber.dispose()
  })

  it('cycles settings values inline under the cc keymap idiom', async () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-tui-cycle-home-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const test = await bench({}, {})
      await test.started
      test.app.handlers?.onCommandPicked('__settings', '')
      await settle(150)
      // cc 键位默认 → 可循环行携带 cycle 数据。
      const rows = test.app.settingsShown[0]
      expect(rows.find(row => row.key === '主题')?.cycle?.options).toEqual(['web', 'cc', 'pi', 'opencode'])
      expect(rows.find(row => row.key === '配置文件')?.cycle).toBeUndefined()
      // 主题行 →：web → cc。
      test.app.handlers?.onSettingsRowCycle?.(1, 1)
      await settle(150)
      expect(test.app.themeRefreshes).toBe(1)
      const after = test.app.settingsShown[test.app.settingsShown.length - 1]
      expect(after.find(row => row.key === '主题')?.current).toContain('cc')
      // 语言行 →：zh → en。
      test.app.handlers?.onSettingsRowCycle?.(0, 1)
      await settle(150)
      expect(test.app.toasts.some(toast => toast.text.includes('Language: English'))).toBe(true)
      await test.ctx.fiber.dispose()
    } finally {
      setStrings('zh') // 行内循环切了语言，恢复默认避免污染后续测试
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('cycles the permission preset inline on Ctrl+P under the cc idiom', async () => {
    // 隔离 DSH_HOME：键位 sidecar 的默认值不受开发者本机状态影响（cc 语式）。
    const home = mkdtempSync(join(tmpdir(), 'dsh-tui-perm-cycle-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    const picked: string[] = []
    try {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('permissionPresets', {
        names: ['workspace-write', 'danger-full-access'],
        optionOf: (name: string) => ({ value: name, name, description: `description of ${name}` }),
        current: () => 'workspace-write',
        set: (_session: Session, name: string) => { picked.push(name) },
      } as never)
      ctx.provide('sessionProjections', {
        snapshot: () => ({
          asOfSeq: 0,
          values: {
            permissions: {
              currentValue: 'workspace-write',
              options: [
                { value: 'workspace-write', name: 'workspace-write' },
                { value: 'danger-full-access', name: 'danger-full-access' },
              ],
            },
          },
        }),
      } as never)
    })
    await test.started
    // cc 语式：Ctrl+P 行内循环 → 下一个是 full-access → 保留确认弹窗。
    test.app.dialogAnswer = '我已了解风险，并愿意继续'
    test.app.handlers?.onPermissionPickerRequest?.()
    await settle(150)
    expect(test.app.permissions).toBeUndefined() // 没弹 picker
    expect(picked).toEqual(['danger-full-access'])
    expect(test.app.toasts.some(toast => toast.text.includes('权限预设已切换：danger-full-access'))).toBe(true)
    await test.ctx.fiber.dispose()
    } finally {
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('routes /compose to the editor-compose flow (pi A3)', async () => {
    const test = await bench({}, {})
    await test.started
    test.app.handlers?.onCommandPicked('__compose', '')
    await settle()
    expect(test.app.composes).toBe(1)
    await test.ctx.fiber.dispose()
  })

  it('renames the workspace directory via bare /rename (H11)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-tui-rename-'))
    const ws = join(tmp, 'orig')
    mkdirSync(ws)
    try {
      const test = await bench({}, { workspace: ws })
      await test.started
      // 第一个对话框选目标（工作区目录），第二个输入新目录名。
      test.app.dialogQueue.push('工作区目录', 'renamed')
      test.app.handlers?.onCommandPicked('__rename', '')
      await settle(150)
      expect(existsSync(join(tmp, 'renamed'))).toBe(true)
      expect(existsSync(ws)).toBe(false)
      expect(test.app.workspaces).toContain(join(tmp, 'renamed'))
      expect(test.app.toasts.some(toast => toast.text.includes('工作区已重命名'))).toBe(true)
      await test.ctx.fiber.dispose()
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('opens the preset picker with the current preset marked and applies the pick', async () => {
    const picked: string[] = []
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('permissionPresets', {
        names: ['workspace-write', 'danger-full-access'],
        optionOf: (name: string) => ({
          value: name,
          name,
          description: `description of ${name}`,
        }),
        current: () => 'danger-full-access',
        set: (_session: Session, name: string) => { picked.push(name) },
      } as never)
    })
    await test.started
    test.app.handlers?.onPermissionPickerRequest?.()
    await settle()
    expect(test.app.permissions?.map(item => item.value)).toEqual(['workspace-write', 'danger-full-access'])
    expect(test.app.permissions?.map(item => item.current)).toEqual([false, true])

    test.app.handlers?.onPermissionPicked('workspace-write')
    await settle()
    expect(picked).toEqual(['workspace-write'])
    await test.ctx.fiber.dispose()
  })

  it('opens the command palette with registered commands plus the native extras', async () => {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('commands', {
        list: () => [
          { name: 'goal', description: 'Set the session goal', input: { hint: '<objective>' } },
          { name: 'compact', description: 'Compact the transcript' },
          // The plugin's free-text /permission is replaced by the TUI's
          // enum-aware native row, so it never reaches the catalog.
          { name: 'permission', description: 'Switch the permission preset', input: { hint: '<preset>' } },
        ],
        execute: async () => ({ commandId: 'c1', result: { kind: 'success' as const } }),
      } as never)
    })
    await test.started
    test.app.handlers?.onCommandPickerRequest?.()
    await settle()
    expect(test.app.commands?.map(item => item.value)).toEqual(['goal', 'compact', '__export', '__rate', '__new', '__quit', '__help', '__clone', '__resume', '__effort', '__model', '__permission', '__config', '__lang', '__rename', '__queue', '__trajectory', '__keymap', '__theme', '__preset', '__settings', '__plugins', '__workspace', '__compose'])
    expect(test.app.commands?.find(item => item.value === 'goal')?.label).toBe('/goal <objective>')
    expect(test.app.commands?.find(item => item.value === '__model')?.label).toBe('/model <provider/model>')
    expect(test.app.commands?.find(item => item.value === '__permission')?.label).toBe('/permission <preset>')
    // K1: synonymous invocations register as aliases, not duplicate rows.
    expect(test.app.commands?.find(item => item.value === '__quit')?.aliases).toEqual(['exit'])
    expect(test.app.commands?.find(item => item.value === '__new')?.aliases).toEqual(['clear'])
    expect(test.app.commands?.find(item => item.value === '__help')?.aliases).toEqual(['?'])
    expect(test.app.commands?.find(item => item.value === '__model')?.aliases).toEqual(['m'])
    expect(test.app.commands?.find(item => item.value === '__permission')?.aliases).toEqual(['perm'])
    await test.ctx.fiber.dispose()
  })

  it('surfaces user-invocable skills in the catalog and inserts them into the composer (G22/H33)', async () => {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('commands', { list: () => [], execute: async () => ({ commandId: 'c1', result: { kind: 'success' as const } }) } as never)
      ctx.provide('skills', {
        list: () => [
          { name: 'audit', description: 'audit dependencies', whenToUse: 'checking supply chains', invocation: { userInvocable: true } },
          { name: 'secret-model-only', description: 'model-only', invocation: { userInvocable: false } },
        ],
      } as never)
    })
    await test.started
    test.app.handlers?.onCommandPickerRequest?.()
    await settle()
    const values = test.app.commands?.map(item => item.value)
    expect(values).toContain('__skill:audit')
    expect(values).not.toContain('__skill:secret-model-only')
    // Picking a skill inserts its name into the composer.
    test.app.handlers?.onCommandPicked('__skill:audit')
    await settle()
    expect(test.app.restored).toEqual(['audit'])
    await test.ctx.fiber.dispose()
  })

  it('executes a picked command with dialog input and renders its result', async () => {
    const executed: string[] = []
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('commands', {
        list: () => [{ name: 'goal', description: 'Set the session goal', input: { hint: '<objective>' } }],
        execute: async (_agent: Agent, line: string) => {
          executed.push(line)
          return { commandId: 'c1', result: { kind: 'success' as const, text: 'goal set' } }
        },
      } as never)
    })
    await test.started
    test.app.handlers?.onCommandPicked('goal')
    await settle()
    expect(test.app.questions.map(question => question.title)).toEqual(['/goal <objective>'])
    expect(executed).toEqual(['/goal typed-answer'])
    // P2: the successful result is a transient toast, not a transcript row.
    expect(test.app.toasts.some(toast => toast.text === 'goal set')).toBe(true)
    const last = test.app.last
    expect(last.entries.some(entry => entry.kind === 'notice' && (entry as { text: string }).text === 'goal set')).toBe(false)
    await test.ctx.fiber.dispose()
  })

  it('exports the session log to a revealed jsonl path', async () => {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('sessionPersistence', {
        locate: () => ({ kind: 'jsonl', path: '/tmp/sessions/session-abc.jsonl' }),
      } as never)
    })
    await test.started
    test.app.handlers?.onCommandPicked('__export')
    await settle()
    const last = test.app.last
    expect(last.entries.some(entry => entry.kind === 'notice' && (entry as { text: string }).text.includes('/tmp/sessions/session-abc.jsonl'))).toBe(true)
    await test.ctx.fiber.dispose()
  })

  it('leaves plan mode through /plan off on the exit request', async () => {
    const executed: string[] = []
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('commands', {
        list: () => [],
        execute: async (_agent: Agent, line: string) => { executed.push(line); return { commandId: 'c1', result: { kind: 'success' as const } } },
      } as never)
    })
    await test.started
    // Only acts while the projection reports plan mode.
    test.app.handlers?.onExitPlanModeRequest?.()
    expect(executed).toEqual([])
    const session = test.ctx.sessions.list()[0]
    session.append('plan/mode', { active: true } as never)
    await settle()
    test.app.handlers?.onExitPlanModeRequest?.()
    expect(executed).toEqual(['/plan off'])
    await test.ctx.fiber.dispose()
  })

  it('switches the workspace to a new directory session', async () => {
    const test = await bench({}, {}, undefined)
    await test.started
    test.app.dialogAnswer = '/tmp'
    test.app.handlers?.onWorkspaceSwitchRequest?.()
    await settle(150)
    expect(test.created).toHaveLength(2)
    expect(test.created[1].meta?.cwd).toBe('/tmp')
    expect(test.app.meta?.workspace).toBe('/tmp')
    expect(test.app.resets).toBe(2)
    expect(test.app.workspaces).toEqual(['/tmp'])
    await test.ctx.fiber.dispose()
  })

  it('rejects a missing workspace directory with an error notice', async () => {
    const test = await bench({}, {}, undefined)
    await test.started
    test.app.dialogAnswer = '/definitely/not/a/real/dir'
    test.app.handlers?.onWorkspaceSwitchRequest?.()
    await settle()
    expect(test.created).toHaveLength(1) // no new session
    const last = test.app.last
    expect(last.entries.some(entry => entry.kind === 'notice' && (entry as { text: string }).text.includes('目录不存在'))).toBe(true)
    await test.ctx.fiber.dispose()
  })

  it('lists fork points and forks a new session at the picked message', async () => {
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 1, message, 'final answer') },
    }, {})
    await test.started
    test.app.input('first question')
    await settle()
    test.app.handlers?.onForkPickerRequest?.()
    await settle()
    expect(test.app.forkPoints?.length).toBe(2) // user + assistant anchors (T3③)
    const seq = Number(test.app.forkPoints![0].value)
    expect(test.app.forkPoints![0].label).toBe('first question')
    expect(test.app.forkPoints![1].description).toContain('assistant')
    test.app.handlers?.onForkPicked(seq)
    await settle()
    expect(test.created).toHaveLength(2)
    const child = test.created[1]
    expect(child.seed?.length).toBeGreaterThan(0)
    expect(child.meta?.parentSession).toBe(test.created[0].sessionId)
    expect(test.app.meta?.session).toBe(child.sessionId)
    expect(test.app.resets).toBe(2)
    const last = test.app.last
    expect(last.entries.some(entry => entry.kind === 'notice' && (entry as { text: string }).text.includes('分支新会话'))).toBe(true)
    await test.ctx.fiber.dispose()
  })

  it('rejects forking at a message whose turn is still open', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
        // turn left open: no turn/end at-or-after the message seq
      },
    }, {})
    await test.started
    test.app.input('open question')
    await settle()
    const seq = test.app.last.entries.find(entry => entry.kind === 'user')?.id.slice(1)
    test.app.handlers?.onForkPicked(Number(seq))
    await settle()
    expect(test.created).toHaveLength(1)
    const last = test.app.last
    expect(last.entries.some(entry => entry.kind === 'notice' && (entry as { text: string }).text.includes('尚未完成'))).toBe(true)
    await test.ctx.fiber.dispose()
  })

  it('rates the latest reply into the TUI feedback sidecar and replays the summary', async () => {
    const home = join(tmpdir(), `dsh-tui-fb-${Date.now()}`)
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      // A persisted rating for a not-yet-open session surfaces on its boot.
      const { mkdirSync, writeFileSync } = await import('node:fs')
      mkdirSync(home, { recursive: true })
      writeFileSync(join(home, 'tui-feedback.json'), JSON.stringify([
        { sessionId: 'session-summary-check', messageId: 'm-old', rating: 'negative', note: 'hallucinated', at: 1 },
      ]))
      const test = await bench({
        afterPrompt(session, message) {
          appendTurn(session, 1, message, '')
          session.append('assistant/message', {
            turn: 1, step: 1,
            message: {
              role: 'assistant',
              id: 'msg-older' as never,
              content: [{ type: 'text', text: 'earlier answer' }],
              source: { kind: 'model', provider: 'test-provider', model: 'test-model' },
            },
          }, { surfaceOp: 'append' })
          session.append('assistant/message', {
            turn: 1, step: 2,
            message: {
              role: 'assistant',
              id: 'msg-rated' as never,
              content: [{ type: 'text', text: 'final answer' }],
              source: { kind: 'model', provider: 'test-provider', model: 'test-model' },
            },
          }, { surfaceOp: 'append' })
        },
      }, {})
      await test.started
      // Boot the session carrying the persisted rating → summary row first.
      test.app.handlers?.onSessionPicked('session-summary-check')
      await settle(150)
      expect(test.app.last.entries[0]).toMatchObject({ kind: 'notice', text: '已记录反馈：👍 0 · 👎 1' })
      const sessionId = test.app.meta!.session
      expect(sessionId).toBe('session-summary-check')
      // Rate the FOCUSED reply (T3④): the older assistant message wins over
      // the latest one when a frame holds focus. FakeApp picks 👍 有用.
      test.app.input('rate me')
      await settle()
      test.app.focusedId = '1:1'
      test.app.handlers?.onCommandPicked('__rate')
      await settle()
      expect(test.app.questions.map(question => question.title)).toContain('评价最近回复')
      const records = JSON.parse(readFileSync(join(home, 'tui-feedback.json'), 'utf8')) as Array<{ sessionId: string; messageId: string; rating: string; at: number }>
      expect(records).toEqual([
        { sessionId: 'session-summary-check', messageId: 'm-old', rating: 'negative', note: 'hallucinated', at: 1 },
        { sessionId, messageId: 'msg-older', rating: 'positive', at: expect.any(Number) },
      ])
      const last = test.app.last
      // P2: rating feedback is a transient toast; only the persisted
      // summary row stays in the transcript.
      expect(test.app.toasts.some(toast => toast.text.includes('已记录反馈 👍'))).toBe(true)
      expect(last.entries.some(entry => entry.kind === 'notice' && (entry as { text: string }).text.includes('已记录反馈 👍'))).toBe(false)
      await test.ctx.fiber.dispose()
    } finally {
      process.env.DSH_HOME = previousHome
    }
  })

  it('steers while busy and falls back to a follow-up when idle (T5②)', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
      },
    }, {})
    await test.started
    test.app.input('first')
    await settle()
    test.app.handlers?.onSteerRequest?.('steered while busy')
    await settle()
    expect(test.steers).toHaveLength(1)
    expect(test.steers[0].content[0]).toEqual({ type: 'text', text: 'steered while busy' })
    // Idle fallback routes through the normal input path.
    const session = test.ctx.sessions.list()[0]
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    await settle()
    test.app.handlers?.onSteerRequest?.('idle steer')
    await settle()
    expect(test.followups).toHaveLength(2)
    await test.ctx.fiber.dispose()
  })

  it('retrieves the last queued message back to the composer (T5②)', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
      },
    }, {})
    await test.started
    test.app.input('first')
    await settle()
    test.app.input('queued-a')
    test.app.input('queued-b')
    await settle()
    test.app.handlers?.onQueueRetrieveRequest?.()
    await settle()
    expect(test.app.restored).toEqual(['queued-b']) // LIFO retrieve
    expect(test.app.queues.at(-1)).toBe(1)
    await test.ctx.fiber.dispose()
  })

  it('lists the queue dock and deletes a picked item (E1)', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
      },
    }, {})
    await test.started
    test.app.input('first')
    await settle()
    test.app.input('queued-a')
    test.app.input('queued-b')
    await settle()
    // /queue opens the dock with one row per queued message.
    test.app.handlers?.onCommandPicked('__queue', '')
    await settle()
    expect(test.app.queueRows).toHaveLength(1)
    expect(test.app.queueRows[0].map(row => row.label)).toEqual(['1. queued-a', '2. queued-b'])
    // Picking a row asks retrieve-or-delete; deleting shrinks the queue.
    const picked = test.app.queuePicked
    expect(picked).toBeDefined()
    test.app.dialogAnswer = '删除'
    picked?.('1')
    await settle()
    expect(test.app.queues.at(-1)).toBe(1)
    // The remaining item can be retrieved back to the composer.
    test.app.dialogAnswer = '取回到输入框'
    picked?.('0')
    await settle()
    expect(test.app.restored).toEqual(['queued-a'])
    expect(test.app.queues.at(-1)).toBe(0)
    await test.ctx.fiber.dispose()
  })

  it('routes visible shell output to the model and hidden output to a notice', async () => {
    const test = await bench({}, {})
    await test.started
    test.app.handlers?.onShellResult('$ echo hi\nhi', false)
    await settle()
    expect(test.followups).toHaveLength(1)
    expect(test.followups[0].content[0]).toEqual({ type: 'text', text: '$ echo hi\nhi' })
    test.app.handlers?.onShellResult('$ echo hi\nhi', true)
    await settle()
    const last = test.app.last
    expect(last.entries.some(entry => entry.kind === 'notice' && (entry as { text: string }).text.includes('未发送给模型'))).toBe(true)
    expect(test.followups).toHaveLength(1) // hidden output never reaches the model
    await test.ctx.fiber.dispose()
  })

  it('shows the /hotkeys reference panel', async () => {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('commands', { list: () => [], execute: async () => ({ commandId: 'c1', result: { kind: 'success' as const } }) } as never)
    })
    await test.started
    test.app.handlers?.onCommandPicked('__help')
    await settle()
    expect(test.app.hotkeysShown).toBe(1)
    await test.ctx.fiber.dispose()
  })

  it('resolves --continue to the most recent session (T5⑦)', async () => {
    const test = await bench({}, { resume: '__latest__' }, (ctx) => {
      ctx.provide('sessionQuery', {
        listSessions: async () => [
          { header: { version: 1, id: 'session-old' as never, createdAt: 1_000, cwd: '/tmp' }, live: false, persisted: true },
          { header: { version: 1, id: 'session-new' as never, createdAt: 9_000, cwd: '/tmp' }, live: false, persisted: true },
        ],
        readTitle: async () => undefined,
      })
    })
    await test.started
    expect(test.resumed[0].resumeSessionId).toBe('session-new')
    await test.ctx.fiber.dispose()
  })

  it('opens the session picker right after boot on --browse (T5⑦)', async () => {
    const test = await bench({}, { browse: true }, (ctx) => {
      ctx.provide('sessionQuery', { listSessions: async () => [], readTitle: async () => undefined })
    })
    await test.started
    await settle()
    expect(test.app.sessions).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('skips the quit flush with --no-session (T5⑦)', async () => {
    const test = await bench({}, { noSession: true })
    await test.started
    test.app.handlers?.onQuit()
    expect(await test.exitCode).toBe(0)
    expect(test.order).toEqual(['exit']) // no 'flush'
    await test.ctx.fiber.dispose()
  })

  it('clones the current session from its last completed turn (T5⑦)', async () => {
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 1, message, 'final answer') },
    }, {})
    await test.started
    test.app.input('clone me')
    await settle()
    test.app.handlers?.onCommandPicked('__clone')
    await settle()
    expect(test.created).toHaveLength(2)
    expect(test.created[1].seed?.length).toBeGreaterThan(0)
    const last = test.app.last
    expect(last.entries.some(entry => entry.kind === 'notice' && (entry as { text: string }).text.includes('已复制当前会话'))).toBe(true)
    await test.ctx.fiber.dispose()
  })

  it('picks the reasoning effort independently via /effort (T7)', async () => {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('llm', {
        listProviders: () => [],
        listModels: async () => [],
        resolveModelInfo: async () => ({
          context: { contextWindow: 128_000 },
          reasoning: { efforts: [{ id: 'high', name: 'High effort' }, { id: 'low', name: 'Low effort' }] },
        }),
      })
    })
    await test.started
    test.app.handlers?.onCommandPicked('__effort')
    await settle()
    const effort = test.app.questions.find(question => question.title === '推理等级')
    expect(effort?.options).toEqual(['High effort', 'Low effort'])
    // FakeApp picks the first option → the selection carries the effort
    // (P2: a transient toast, not a transcript row).
    expect(test.app.toasts.some(toast => toast.text.includes('High effort'))).toBe(true)
    await test.ctx.fiber.dispose()
  })

  it('confirms before enabling Full access (web copy reuse)', async () => {
    const set: string[] = []
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('permissionPresets', {
        names: ['workspace-write', 'danger-full-access'],
        optionOf: (name: string) => ({ value: name, name }),
        current: () => 'workspace-write',
        set: (_session: Session, name: string) => { set.push(name) },
      } as never)
    })
    await test.started
    test.app.handlers?.onPermissionPicked('danger-full-access')
    await settle()
    expect(test.app.questions[0].title).toBe('确认启用 Full access？')
    expect(test.app.questions[0].options).toEqual(['我已了解风险，并愿意继续', '取消'])
    // FakeApp picks the first option (acknowledge) → the switch applies.
    expect(set).toEqual(['danger-full-access'])
    await test.ctx.fiber.dispose()
  })

  it('skips the confirm when Full access is cancelled', async () => {
    const set: string[] = []
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('permissionPresets', {
        names: ['workspace-write', 'danger-full-access'],
        optionOf: (name: string) => ({ value: name, name }),
        current: () => 'workspace-write',
        set: (_session: Session, name: string) => { set.push(name) },
      } as never)
    })
    await test.started
    test.app.dialogAnswer = '取消'
    test.app.handlers?.onPermissionPicked('danger-full-access')
    await settle()
    expect(set).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('switches the language through /lang (T9)', async () => {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('commands', { list: () => [], execute: async () => ({ commandId: 'c1', result: { kind: 'success' as const } }) } as never)
    })
    await test.started
    test.app.handlers?.onCommandPicked('__lang')
    await settle()
    expect(test.app.questions[0].title).toBe('选择语言')
    expect(test.app.questions[0].options).toEqual(['中文', 'English'])
    // FakeApp picks the first option (中文); P2 → transient toast.
    expect(test.app.toasts.some(toast => toast.text.includes('语言：中文'))).toBe(true)
    await test.ctx.fiber.dispose()
  })

  it('lists provider models and applies the picked model to later sessions', async () => {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('llm', {
        listProviders: () => [
          { id: 'pi-ai', name: 'Pi AI' },
          { id: 'deepseek-official', name: 'DeepSeek' },
        ],
        listModels: async (provider: string) => provider === 'pi-ai'
          ? [{ provider: 'pi-ai', id: 'deepseek-v4', name: 'DeepSeek V4' }]
          : [{ provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'V4 Flash' }],
        resolveModelInfo: async () => ({
          context: { contextWindow: 128_000 },
          reasoning: {
            efforts: [
              { id: 'high', name: 'High effort', description: 'thinks harder' },
              { id: 'low', name: 'Low effort' },
            ],
          },
        }),
      })
    })
    await test.started
    test.app.handlers?.onModelPickerRequest?.()
    await settle()
    expect(test.app.models?.map(item => item.value)).toEqual(['pi-ai/deepseek-v4', 'deepseek-official/deepseek-v4-flash'])
    // The adapter-reported context window lands in the surface meta.
    expect(test.app.meta?.contextWindow).toBe(128_000)

    test.app.handlers?.onModelPicked('pi-ai/deepseek-v4')
    await settle()
    // Model and effort pick independently (T7): no chained effort dialog.
    expect(test.app.questions).toEqual([])
    test.app.handlers?.onSessionPicked('session-old')
    await settle(150)
    expect(test.resumed[0].agentOptions).toEqual({ provider: 'pi-ai', model: 'deepseek-v4' })
    await test.ctx.fiber.dispose()
  })

  it('opens the model enum picker from a bare /model slash command', async () => {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('llm', {
        listProviders: () => [{ id: 'pi-ai', name: 'Pi AI' }],
        listModels: async () => [{ provider: 'pi-ai', id: 'deepseek-v4', name: 'DeepSeek V4' }],
      })
    })
    await test.started
    test.app.handlers?.onCommandPicked('__model', '')
    await settle()
    expect(test.app.models?.map(item => item.value)).toEqual(['pi-ai/deepseek-v4'])
    await test.ctx.fiber.dispose()
  })

  it('switches the model directly from /model provider/model', async () => {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('llm', {
        listProviders: () => [{ id: 'pi-ai', name: 'Pi AI' }],
        listModels: async () => [{ provider: 'pi-ai', id: 'deepseek-v4', name: 'DeepSeek V4' }],
      })
    })
    await test.started
    test.app.handlers?.onCommandPicked('__model', 'pi-ai/deepseek-v4')
    await settle()
    // The footer identity tracks the switch immediately (T10①).
    expect(test.app.meta?.model).toBe('pi-ai/deepseek-v4')
    expect(test.app.toasts.some(toast => toast.text.includes('pi-ai/deepseek-v4'))).toBe(true)
    // The next session boots with the switched model.
    test.app.handlers?.onSessionPicked('session-old')
    await settle(150)
    expect(test.resumed[0].agentOptions).toEqual({ provider: 'pi-ai', model: 'deepseek-v4' })
    await test.ctx.fiber.dispose()
  })

  it('rejects an unknown /model argument with an error notice', async () => {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('llm', {
        listProviders: () => [{ id: 'pi-ai', name: 'Pi AI' }],
        listModels: async () => [{ provider: 'pi-ai', id: 'deepseek-v4', name: 'DeepSeek V4' }],
      })
    })
    await test.started
    test.app.handlers?.onCommandPicked('__model', 'no-such/model')
    await settle()
    const last = test.app.last
    expect(last.entries.some(entry => entry.kind === 'notice' && (entry as { text: string }).text.includes('未知模型'))).toBe(true)
    expect(test.app.meta?.model).toBe('test-provider/test-model')
    await test.ctx.fiber.dispose()
  })

  it('opens the permission enum picker from a bare /permission slash command', async () => {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('permissionPresets', {
        names: ['workspace-write', 'danger-full-access'],
        optionOf: (name: string) => ({ value: name, name }),
        current: () => 'workspace-write',
        set: () => {},
      } as never)
    })
    await test.started
    test.app.handlers?.onCommandPicked('__permission', '')
    await settle()
    expect(test.app.permissions?.map(item => item.value)).toEqual(['workspace-write', 'danger-full-access'])
    await test.ctx.fiber.dispose()
  })

  it('switches the permission preset directly from /permission <preset>', async () => {
    const set: string[] = []
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('permissionPresets', {
        names: ['workspace-write', 'danger-full-access'],
        optionOf: (name: string) => ({ value: name, name }),
        current: () => 'workspace-write',
        set: (_session: Session, name: string) => { set.push(name) },
      } as never)
    })
    await test.started
    test.app.handlers?.onCommandPicked('__permission', 'workspace-write')
    await settle()
    expect(set).toEqual(['workspace-write'])
    expect(test.app.toasts.some(toast => toast.text.includes('workspace-write'))).toBe(true)
    // Direct switching to Full access keeps the web confirmation.
    test.app.handlers?.onCommandPicked('__permission', 'danger-full-access')
    await settle()
    expect(test.app.questions[0].title).toBe('确认启用 Full access？')
    expect(set).toEqual(['workspace-write', 'danger-full-access'])
    await test.ctx.fiber.dispose()
  })

  it('rejects an unknown /permission argument with an error notice', async () => {
    const set: string[] = []
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('permissionPresets', {
        names: ['workspace-write'],
        optionOf: (name: string) => ({ value: name, name }),
        current: () => 'workspace-write',
        set: (_session: Session, name: string) => { set.push(name) },
      } as never)
    })
    await test.started
    test.app.handlers?.onCommandPicked('__permission', 'nope')
    await settle()
    const last = test.app.last
    expect(last.entries.some(entry => entry.kind === 'notice' && (entry as { text: string }).text.includes('未知权限预设'))).toBe(true)
    expect(set).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('opens the /config menu and lists configurable providers (K2)', async () => {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('settings', {
        documentPath: '/home/u/.dsh/settings.yaml',
        get: (ns: string) => ({ 'llm-pi-ai': { providers: { 'pi-ai': { displayName: 'Pi AI' } } } }[ns]),
        update: async () => {},
        register: () => ({ get: () => ({}), watch: () => {} }),
      } as never)
      ctx.provide('llm', {
        listProviders: () => [],
        listModels: async () => [],
        listConfigurableProviders: () => [
          { provider: 'pi-ai', displayName: 'Pi AI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'pi-ai'], declared: false },
          { provider: 'my-gw', displayName: 'My GW', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'my-gw'], declared: true },
        ],
      })
    })
    await test.started
    test.app.handlers?.onCommandPicked('__config')
    await settle()
    expect(test.app.questions[0].title).toBe('配置')
    expect(test.app.questions[0].options).toEqual(['供应商列表', '添加供应商', '预览配置文件', '在编辑器中打开', '复制配置文件路径'])
    // 供应商列表 → 目录行进入通用 picker，resolved profile 在描述里。
    test.app.dialogQueue.push('供应商列表')
    test.app.handlers?.onCommandPicked('__config')
    await settle()
    expect(test.app.queueRows.at(-1)?.map(row => row.label)).toEqual(['Pi AI', 'My GW'])
    expect(test.app.queueRows.at(-1)?.[0].description).toContain('{"displayName":"Pi AI"}')
    expect(test.app.queueRows.at(-1)?.[1].description).toContain('自定义路由')
    await test.ctx.fiber.dispose()
  })

  it('adds a provider through the /config wizard via the settings seam (K2)', async () => {
    const patches: Array<[string, Record<string, unknown>]> = []
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('settings', {
        documentPath: '/home/u/.dsh/settings.yaml',
        update: async (ns: string, patch: Record<string, unknown>) => { patches.push([ns, patch]) },
        register: () => ({ get: () => ({}), watch: () => {} }),
      } as never)
      ctx.provide('llm', {
        listProviders: () => [],
        listModels: async () => [],
        listConfigurableProviders: () => [
          { provider: 'pi-ai', displayName: 'Pi AI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'pi-ai'], declared: false },
        ],
      })
    })
    await test.started
    // 菜单 → 添加供应商 → 自定义路由 → 字段（显示名/baseURL/协议/密钥环境变量）。
    test.app.dialogQueue.push('添加供应商', '自定义新路由', 'my-gw', 'My Gateway', 'https://gw.example.com/v1', 'anthropic-messages', 'MY_KEY')
    test.app.handlers?.onCommandPicked('__config')
    await settle()
    const routeQuestion = test.app.questions.find(question => question.title === '添加供应商')
    expect(routeQuestion?.options).toEqual(['pi-ai · Pi AI', '自定义新路由'])
    expect(patches).toEqual([['llm-pi-ai', {
      providers: { 'my-gw': {
        displayName: 'My Gateway', baseURL: 'https://gw.example.com/v1', api: 'anthropic-messages', apiKeyEnv: 'MY_KEY',
      } },
    }]])
    expect(test.app.toasts.some(toast => toast.text.includes('my-gw'))).toBe(true)
    await test.ctx.fiber.dispose()
  })

  it('opens the settings file in an editor and copies its path (K2)', async () => {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('settings', { documentPath: '/home/u/.dsh/settings.yaml', update: async () => {}, register: () => ({ get: () => ({}), watch: () => {} }) } as never)
    })
    await test.started
    test.app.dialogQueue.push('在编辑器中打开')
    test.app.handlers?.onCommandPicked('__config')
    await settle()
    expect(test.app.editors).toEqual(['/home/u/.dsh/settings.yaml'])
    test.app.dialogQueue.push('复制配置文件路径')
    test.app.handlers?.onCommandPicked('__config')
    await settle()
    expect(test.app.copied).toEqual(['/home/u/.dsh/settings.yaml'])
    await test.ctx.fiber.dispose()
  })

  it('degrades /config to a path-only surface without the settings service', async () => {
    const test = await bench({}, {}, undefined)
    await test.started
    test.app.dialogQueue.push('添加供应商')
    test.app.handlers?.onCommandPicked('__config')
    await settle()
    expect(test.app.toasts.some(toast => toast.text.includes('settings 服务不可用'))).toBe(true)
    test.app.dialogQueue.push('预览配置文件')
    test.app.handlers?.onCommandPicked('__config')
    await settle()
    // 无 settings 服务时路径回退到 DSH_HOME/settings.yaml 并被如实展示。
    expect(test.app.questions.at(-1)?.title).toContain('settings.yaml')
    await test.ctx.fiber.dispose()
  })

  it('renders select-shaped plugin projections and picks them via Ctrl+P (K3)', async () => {
    // list 语式（pi 键位）下测 picker 语义；cc 语式走行内循环（另有专测）。
    const previousKeymap = process.env.DSH_TUI_KEYMAP
    process.env.DSH_TUI_KEYMAP = 'pi'
    const set: string[] = []
    try {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('permissionPresets', {
        names: ['workspace-write', 'danger-full-access'],
        optionOf: (name: string) => ({ value: name, name }),
        current: () => 'workspace-write',
        set: (_session: Session, name: string) => { set.push(name) },
      } as never)
      ctx.provide('sessionProjections', {
        snapshot: () => ({
          asOfSeq: 0,
          values: {
            permissions: {
              options: [
                { value: 'workspace-write', name: 'workspace-write', description: 'write in the workspace' },
                { value: 'danger-full-access', name: 'danger-full-access' },
              ],
              currentValue: 'workspace-write',
            },
          },
        }),
        onChanged: () => () => {},
      } as never)
    })
    await test.started
    // boot 后投影行已推给视图。
    expect(test.app.projectionRows.at(-1)).toEqual([{
      key: 'permissions', currentValue: 'workspace-write',
      options: [
        { value: 'workspace-write', name: 'workspace-write', description: 'write in the workspace' },
        { value: 'danger-full-access', name: 'danger-full-access' },
      ],
    }])
    // Ctrl+P 走通用枚举 picker：permissions 投影复用权限 picker（含确认）。
    test.app.handlers?.onPermissionPickerRequest?.()
    await settle()
    expect(test.app.permissions?.map(item => item.label)).toEqual(['workspace-write', 'danger-full-access'])
    expect(test.app.permissions?.[0].current).toBe(true)
    test.app.handlers?.onPermissionPicked('danger-full-access')
    await settle()
    expect(set).toEqual(['danger-full-access'])
    await test.ctx.fiber.dispose()
    } finally {
      if (previousKeymap === undefined) delete process.env.DSH_TUI_KEYMAP
      else process.env.DSH_TUI_KEYMAP = previousKeymap
    }
  })

  it('writes generic projection picks through the same-named command (K3)', async () => {
    const executed: string[] = []
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('sessionProjections', {
        snapshot: () => ({
          asOfSeq: 0,
          values: {
            goal: { options: [{ value: 'a', name: 'Goal A' }, { value: 'b', name: 'Goal B' }], currentValue: 'a' },
          },
        }),
        onChanged: () => () => {},
      } as never)
      ctx.provide('commands', {
        list: () => [{ name: 'goal', description: 'Set the goal', input: { hint: '<objective>' } }],
        execute: async (_agent: Agent, line: string) => {
          executed.push(line)
          return { commandId: 'c', result: { kind: 'success' as const, text: 'goal set' } }
        },
      } as never)
    })
    await test.started
    test.app.handlers?.onPermissionPickerRequest?.()
    await settle()
    expect(test.app.queueTitles.at(-1)).toBe('goal')
    expect(test.app.queueRows.at(-1)?.map(row => row.label)).toEqual(['Goal A', 'Goal B'])
    test.app.queuePicked?.('b')
    await settle()
    expect(executed).toEqual(['/goal b'])
    expect(test.app.toasts.some(toast => toast.text === 'goal set')).toBe(true)
    await test.ctx.fiber.dispose()
  })

  it('chooses between several select projections first, then offers the enum (K3)', async () => {
    // list 语式（pi 键位）下测「先选投影再枚举」语义。
    const previousKeymap = process.env.DSH_TUI_KEYMAP
    process.env.DSH_TUI_KEYMAP = 'pi'
    try {
      const test = await bench({}, {}, (ctx) => {
      ctx.provide('permissionPresets', {
        names: ['workspace-write'],
        optionOf: (name: string) => ({ value: name, name }),
        current: () => 'workspace-write',
        set: () => {},
      } as never)
      ctx.provide('sessionProjections', {
        snapshot: () => ({
          asOfSeq: 0,
          values: {
            permissions: { options: [{ value: 'workspace-write', name: 'workspace-write' }], currentValue: 'workspace-write' },
            goal: { options: [{ value: 'a', name: 'Goal A' }], currentValue: 'a' },
          },
        }),
        onChanged: () => () => {},
      } as never)
    })
    await test.started
    test.app.handlers?.onPermissionPickerRequest?.()
    await settle()
    // 第一级：选择投影。
    expect(test.app.queueTitles.at(-1)).toBe('权限')
    expect(test.app.queueRows.at(-1)?.map(row => row.label)).toEqual(['权限', 'goal'])
    // 选 permissions → 第二级：该投影的枚举 picker。
    test.app.queuePicked?.('permissions')
    await settle()
    expect(test.app.permissions?.map(item => item.value)).toEqual(['workspace-write'])
    await test.ctx.fiber.dispose()
    } finally {
      if (previousKeymap === undefined) delete process.env.DSH_TUI_KEYMAP
      else process.env.DSH_TUI_KEYMAP = previousKeymap
    }
  })

  it('reports a projection without a writable command (K3)', async () => {
    const test = await bench({}, {}, (ctx) => {
      ctx.provide('sessionProjections', {
        snapshot: () => ({
          asOfSeq: 0,
          values: {
            ghost: { options: [{ value: 'x', name: 'X' }, { value: 'y', name: 'Y' }], currentValue: 'x' },
          },
        }),
        onChanged: () => () => {},
      } as never)
    })
    await test.started
    test.app.handlers?.onPermissionPickerRequest?.()
    await settle()
    test.app.queuePicked?.('y')
    await settle()
    expect(test.app.toasts.some(toast => toast.text.includes('没有对应的写命令'))).toBe(true)
    await test.ctx.fiber.dispose()
  })
})
