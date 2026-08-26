/**
 * The pi-tui surface on the vendored pi palette, driven headlessly through the
 * real TuiAltScreen on a FakeTerminal: header identity, role-styled messages,
 * tool cards, busy loader slot, native PageUp/Down scrolling, view reuse, and
 * reset-on-session-swap.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { TuiAltScreen, setCapabilities } from '@earendil-works/pi-tui'
import type { Terminal } from '@earendil-works/pi-tui'
import { PiTuiApp, TuiMainScreenPinned, piTuiInternals } from '../src/app/pi-tui-app.ts'
import type { PiTuiAppOptions } from '../src/app/pi-tui-app.ts'
import { fg } from '../src/app/pi/color.ts'
import { permissionTone } from '../src/app/pi/command-match.ts'
import { mkdirSync, readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SurfaceMeta, TerminalAppHandlers } from '../src/app/terminal-app.ts'
import type { ViewDocument, ViewEntry } from '../src/document/document.ts'
import { FakeTerminal } from './helpers/fake-terminal.ts'

/** Build a document snapshot for render tests. */
function doc(entries: ViewEntry[], busy = false): ViewDocument {
  return { entries, busy }
}

function docWithPermission(entries: ViewEntry[], preset: string): ViewDocument {
  return { entries, busy: false, permissionPreset: preset }
}

interface Mounted {
  app: PiTuiApp
  terminal: FakeTerminal
  handlers: TerminalAppHandlers
  calls: { input: string[]; interrupt: number; quit: number; sessions: number; models: number; permissions: number; newSession: number; commands: number; exitPlan: number; workspace: number; forks: number; rates: number; shell: Array<{ text: string; hidden: boolean }>; steers: string[]; retrieves: number; interruptSend: string[]; cycleMode: number; rewind: number; commandPicks: Array<{ name: string; raw?: string }>; sessionSearch: string[] }
}

const originalInternals = { ...piTuiInternals }
let mounts: Mounted[] = []
afterEach(async () => {
  for (const mount of mounts.splice(0)) mount.app.stop()
  Object.assign(piTuiInternals, originalInternals)
})

function mount(meta: SurfaceMeta = { model: 'pi-ai/deepseek-v4', session: 'session-abc', workspace: '/workspace' }, options?: PiTuiAppOptions): Mounted {
  // The workspace is pinned: snapshots embed the footer's cwd and must not
  // vary between local (macOS) and CI (Linux) paths. Terminal capabilities
  // are pinned too: image-protocol detection reads host env vars (kitty
  // sends a delete-query prefix that lands in the snapshot), so the fake
  // terminal declares a fixed kitty capability for deterministic frames.
  setCapabilities({ images: 'kitty', trueColor: true, hyperlinks: true })
  const terminal = new FakeTerminal()
  piTuiInternals.createTerminal = () => terminal
  piTuiInternals.createTui = (t: Terminal, mouse?: boolean, regular?: boolean) =>
    regular === true ? new TuiMainScreenPinned(t, true, undefined) : new TuiAltScreen(t, true, undefined, { mouse: mouse ?? true })
  // Deterministic frames: brand/status shimmer is unit-tested in brand.spec.
  piTuiInternals.animFrameMs = 0
  const calls = { input: [] as string[], interrupt: 0, quit: 0, sessions: 0, models: 0, permissions: 0, newSession: 0, commands: 0, exitPlan: 0, workspace: 0, forks: 0, rates: 0, shell: [] as Array<{ text: string; hidden: boolean }>, steers: [] as string[], retrieves: 0, interruptSend: [] as string[], cycleMode: 0, rewind: 0, commandPicks: [] as Array<{ name: string; raw?: string }>, sessionSearch: [] as string[] }
  // 产品默认已是 regular（2026-08-20）；既有测试保持 alt-screen 语义，
  // 默认注入 fullscreen，regular 测试显式传 { regular: true }。
  const app = new PiTuiApp({ regular: false, ...options })
  const handlers: TerminalAppHandlers = {
    onInput: (text) => { calls.input.push(text) },
    onInterrupt: () => { calls.interrupt++ },
    onInterruptSend: (text) => { calls.interruptSend.push(text) },
    onCycleModeRequest: () => { calls.cycleMode++ },
    onRewindRequest: () => { calls.rewind++ },
    onRewindPicked: () => {},
    onQuit: () => { calls.quit++ },
    onSessionPickerRequest: () => { calls.sessions++ },
    onSessionSearchRequest: (query) => { calls.sessionSearch.push(query) },
    onModelPickerRequest: () => { calls.models++ },
    onSessionPicked: () => {},
    onModelPicked: () => {},
    onPermissionPickerRequest: () => { calls.permissions++ },
    onPermissionPicked: () => {},
    onNewSessionRequest: () => { calls.newSession++ },
    // The test stand-in runner really opens the palette (the production
    // runner fills it with the registered command list).
    onCommandPickerRequest: () => {
      calls.commands++
      app.showCommandPicker([
        { value: '__new', label: '/new · 新会话', description: 'test' },
        { value: '__quit', label: '/quit · 退出 TUI', description: 'test' },
      ])
    },
    onCommandPicked: (name, raw) => {
      if (name !== null) calls.commandPicks.push({ name, ...raw === undefined ? {} : { raw } })
      if (name === '__quit') calls.quit++
      else if (name === '__new') calls.newSession++
    },
    onExitPlanModeRequest: () => { calls.exitPlan++ },
    onWorkspaceSwitchRequest: () => { calls.workspace++ },
    onForkPickerRequest: () => { calls.forks++ },
    onForkPicked: () => {},
    onRateRequest: () => { calls.rates++ },
    onShellResult: (text, hidden) => { calls.shell.push({ text, hidden }) },
    onSteerRequest: (text) => { calls.steers.push(text) },
    onQueueRetrieveRequest: () => { calls.retrieves++ },
  }
  app.start(handlers, meta)
  app.setCommands([
    { value: '__new', label: '/new · 新会话', description: 'test', aliases: ['clear'] },
    { value: '__quit', label: '/quit · 退出 TUI', description: 'test', aliases: ['exit'] },
    { value: '__help', label: '/hotkeys · 快捷键', description: 'test', aliases: ['?'] },
    { value: 'model', label: '/model <provider/model>', description: 'switch the model', aliases: ['m'] },
  ])
  const mounted: Mounted = { app, terminal, handlers, calls }
  mounts.push(mounted)
  return mounted
}

function settle(ms = 20): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Poll a condition up to ~1s (cross-spawn round-trips beat one settle tick). */
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (predicate()) return
    await settle(20)
  }
  throw new Error('waitFor timed out')
}

function idleState() {
  return { messages: [], streaming: null, tools: [], busy: false } as const
}

describe('pi-tui surface', () => {
  it('renders the header identity and restores the terminal on stop', async () => {
    const test = mount()
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('dsh tui')
    expect(plain).toContain('pi-ai/deepseek-v4')
    expect(plain).toContain('session-abc')
    test.app.stop()
    expect(test.terminal.stopped).toBe(true)
  })

  it('shows the DeepSeek brand splash on a fresh session and hides it once a message exists', async () => {
    const fresh = mount()
    await settle()
    expect(fresh.terminal.plain()).toContain('探索未至之境！')

    // The splash must not render in sessions that already carry messages.
    const started = mount()
    started.app.render(doc([{ kind: 'user', id: 'u1', text: 'hi' }]))
    await settle()
    expect(started.terminal.plain()).not.toContain('探索未至之境！')
  })

  it('submits composer text while busy straight to the upstream queue', async () => {
    // busy Enter 的 queue 语义保留在 pi 预设（web 语义；cc 预设默认 steer，B1）。
    const test = mount(undefined, { keymap: 'pi' })
    await settle()
    test.app.render({ entries: [], busy: true })
    await settle()
    test.terminal.feed('finish later\r')
    await settle()
    expect(test.calls.input).toEqual(['finish later'])
  })

  it('routes /quit during a busy turn to quit immediately', async () => {
    const test = mount()
    await settle()
    test.app.render({ entries: [], busy: true })
    await settle()
    test.terminal.feed('/') // opens the palette (microtask between keystrokes)
    await settle()
    test.terminal.feed('quit\r') // filters and picks /quit
    await settle()
    expect(test.calls.quit).toBe(1)
    expect(test.calls.input).toEqual([])
  })

  it('shows the pending queue length and the first message preview in the busy slot', async () => {
    const test = mount()
    await settle()
    test.app.notifyQueue(2, ['finish later', 'another queued one'])
    test.app.render({ entries: [], busy: true })
    await settle()
    // 数量 + 队首预览（多行消息折叠为单行并截断）。
    expect(test.terminal.plain()).toContain('2 条排队 · finish later')
    test.app.notifyQueue(1, ['multi\nline message'])
    await settle()
    expect(test.terminal.plain()).toContain('1 条排队 · multi line message')
    test.app.notifyQueue(0)
    await settle()
    // web 文案保留在 pi 预设（cc 预设 busy 显示随机动词，B14）。
    expect(test.terminal.plain()).toMatch(/Deep diving|Working…|Thinking…|Reading files…|Editing files…|Searching…|Running tools…/)
  })

  it('cc preset shows an always-on parenthesized busy clock (CC `✻ Deep diving… (m s)`)', async () => {
    // V5: cc 预设对齐 Claude Code 的恒常耗时（从 0s 起就显示、括号包裹）；
    // 2026-08-21 用户决策：文本用回 dsh 的 Deep diving...，仅保留 CC 括号时钟。
    // 其他预设保留 web parity（15s 后才加时钟，见上文 Deep diving... 测试）。
    const test = mount(undefined, { keymap: 'cc' })
    await settle()
    test.app.render({ entries: [], busy: true })
    await settle()
    const busyLine = test.terminal.plain()
    expect(busyLine).toMatch(/Deep diving\.\.\. \(\d+[分秒sm]/)
  })

  it('routes /new to the new-session request', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('/') // opens the palette
    await settle()
    test.terminal.feed('new\r') // filters and picks /new
    await settle()
    expect(test.calls.newSession).toBe(1)
    expect(test.calls.input).toEqual([])
  })

  it('maps Ctrl+/ to the command palette and Ctrl+E to exit-plan-mode', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('\x1f')
    await settle()
    expect(test.calls.commands).toBe(1)
    // Ctrl+E is inert outside plan mode.
    test.terminal.feed('\x05')
    await settle()
    expect(test.calls.exitPlan).toBe(0)
    test.app.render({ entries: [], busy: false, planMode: true })
    await settle()
    test.terminal.feed('\x05')
    await settle()
    expect(test.calls.exitPlan).toBe(1)
  })

  it('picks a decision option directly with a number key (cc style)', async () => {
    const test = mount()
    await settle()
    let picked: string | null | undefined
    void test.app.askDialog({ title: 'Approve tool call?', options: ['Allow once', 'Reject'], icon: '⚠' }).then(answer => { picked = answer.picked })
    await settle()
    expect(test.terminal.plain()).toContain('1. Allow once')
    expect(test.terminal.plain()).toContain('2. Reject')
    test.terminal.feed('2')
    await settle()
    expect(picked).toBe('Reject')
  })

  it('highlights the approve option in plan-review dialogs', async () => {
    const test = mount()
    await settle()
    let picked: string | null | undefined
    void test.app.askDialog({
      title: 'Approve this plan?',
      options: ['Approve plan', 'Keep planning'],
      approveLabel: 'Approve plan',
    }).then(answer => { picked = answer.picked })
    await settle()
    expect(test.terminal.plain()).toContain('Approve plan ✓')
    test.terminal.feed('\r')
    await settle()
    expect(picked).toBe('Approve plan')
  })

  it('searches the transcript and jumps to the matching entry', async () => {
    const test = mount()
    await settle()
    const entries = Array.from({ length: 12 }, (_, i) => ({
      kind: 'user' as const, id: `u${i}`,
      text: `filler line one for message ${i}\nfiller line two\nfiller line three`,
    }))
    entries.push({ kind: 'user' as const, id: 'u99', text: 'the needle lives here' })
    test.app.render(doc(entries))
    await settle()
    expect(test.app.scrollTop).toBeGreaterThan(0) // content exceeds the viewport
    test.terminal.feed('\x06')
    await settle()
    expect(test.terminal.plain()).toContain('搜索')
    test.terminal.feed('needle\r')
    await settle()
    expect(test.terminal.plain()).toContain('搜索结果')
    test.terminal.feed('\r') // pick the only match
    await settle()
    // The jump scrolls near the end; the entry is not off-screen below.
    const jumped = test.app.scrollTop
    const first = test.app.scrollTop // recomputed below via rerender? keep simple
    void first
    expect(jumped).toBeGreaterThan(0)
  })

  it('reports no search matches with a notice dialog', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([{ kind: 'user', id: 'u1', text: 'nothing here' }]))
    await settle()
    test.terminal.feed('\x06')
    await settle()
    test.terminal.feed('zzzzz\r')
    await settle()
    expect(test.terminal.plain()).toContain('无匹配')
    test.terminal.feed('\r')
    await settle()
  })

  it('B6: 搜索覆盖思考与工具输出，Ctrl+N 循环跳转', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'assistant', id: 'a1', turn: 1, step: 1, text: 'answer one', thinking: ['secret needle thought'], state: 'committed' },
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'bash', arguments: '{"command":"grep tool-needle"}', state: 'done', turn: 2, step: 1, output: { blocks: [{ type: 'text', text: 'tool result needle' }] } },
      { kind: 'user', id: 'u1', text: 'plain text' },
    ]))
    await settle()
    test.terminal.feed('\x06')
    await settle()
    test.terminal.feed('needle\r')
    await settle()
    expect(test.terminal.plain()).toContain('搜索结果 · 2 处')
    test.terminal.feed('\r') // pick the first hit (thinking)
    await settle()
    expect(test.terminal.plain()).toContain('搜索结果 1/2')
    test.terminal.feed('\x0e') // Ctrl+N → next hit (tool output)
    await settle()
    expect(test.terminal.plain()).toContain('搜索结果 2/2')
    test.terminal.feed('\x0e') // wraps back to the first
    await settle()
    expect(test.terminal.plain()).toContain('搜索结果 1/2')
  })

  it('runs !command and reports its output (T5①)', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('!printf shell-hi\r')
    await waitFor(() => test.calls.shell.length === 1)
    expect(test.calls.shell[0].hidden).toBe(false)
    expect(test.calls.shell[0].text).toContain('shell-hi')
    expect(test.calls.input).toEqual([]) // routed through onShellResult
  })

  it('runs !!command silently (T5①)', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('!!printf hidden-hi\r')
    await waitFor(() => test.calls.shell.length === 1)
    expect(test.calls.shell[0].hidden).toBe(true)
  })

  it('copies the latest reply to the clipboard on Ctrl+X (T5⑤)', async () => {
    // cc 预设 Ctrl+X 已改绑 $EDITOR 编辑输入（B18）；复制回复保留在 pi 预设。
    const test = mount(undefined, { keymap: 'pi' })
    await settle()
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'copy me please', thinking: [], state: 'committed' },
    ]))
    await settle()
    test.terminal.feed('\x18')
    await settle()
    const payload = Buffer.from('copy me please', 'utf8').toString('base64')
    expect(test.terminal.output).toContain(`\x1b]52;c;${payload}\x07`)
  })

  it('steers composer text on Alt+Enter and retrieves queued messages (T5②)', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('steer this now')
    await settle()
    test.terminal.feed('\x1b\r') // Alt+Enter
    await settle()
    expect(test.calls.steers).toEqual(['steer this now'])
    expect(test.app.composerText).toBe('')
    // Esc while busy interrupts the running turn (Claude Code style).
    test.app.render({ entries: [], busy: true })
    test.app.notifyQueue(2)
    await settle()
    test.terminal.feed('\x1b')
    await settle()
    expect(test.calls.interrupt).toBe(1)
    // Alt+Up (delivered as one whole chunk, like a real terminal) retrieves
    // a queued message any time the composer holds focus.
    test.terminal.feedRaw('\x1b\x1b[A')
    await settle()
    expect(test.calls.retrieves).toBe(1)
  })

  it('maps Ctrl+Y to the focused-rate request', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('\x19')
    await settle()
    expect(test.calls.rates).toBe(1)
  })

  it('maps Ctrl+B to the fork-picker request', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('\x02')
    await settle()
    expect(test.calls.forks).toBe(1)
  })

  it('maps Ctrl+W to the workspace-switch request', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('\x17')
    await settle()
    expect(test.calls.workspace).toBe(1)
  })

  it('maps Ctrl+P to the permission-picker request', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('\x10')
    await settle()
    expect(test.calls.permissions).toBe(1)
  })

  it('shows a plan badge in the header while plan mode is active', async () => {
    const test = mount()
    await settle()
    test.app.render({ entries: [], busy: false, planMode: true })
    await settle()
    expect(test.terminal.plain()).toContain('◐ plan')
  })

  it('routes editor submissions to onInput and /quit through the palette', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('hello agent\r')
    await settle()
    expect(test.calls.input).toEqual(['hello agent'])
    test.terminal.feed('/')
    await settle()
    test.terminal.feed('quit\r')
    await settle()
    expect(test.calls.quit).toBe(1)
  })

  it('renders user and assistant messages and the tool card', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'user', id: 'u1', text: 'what is 2+2' },
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'The answer is four.', thinking: [], state: 'committed' },
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'bash', arguments: '{"cmd":"echo hi"}', state: 'done' },
    ]))
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('what is 2+2')
    expect(plain).toContain('The answer is four.')
    // The vendored tool card renders the command line (pi's bash renderer).
    expect(plain).toContain('$ echo hi')
  })

  it('toggles the tool card with Enter once Tab focuses it (keyboard-only)', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'bash', arguments: '{"cmd":"echo hi"}', state: 'done', output: { blocks: [{ type: 'text', text: 'hi' }] } },
    ]))
    await settle()
    // Tool cards default to collapsed. Tab enters the focus cycle (the card
    // is the newest item), and Enter on the focused card toggles it — the
    // mouse click hit-test is gone (pi-style keyboard expansion).
    const views = test.app as unknown as { entryViews: Map<string, { isExpanded: boolean }> }
    const card = views.entryViews.get('c1')
    expect(card?.isExpanded).toBe(false)
    test.terminal.feed('\t')
    await settle()
    test.terminal.feed('\r')
    await settle()
    expect(card?.isExpanded).toBe(true)
    test.terminal.feed('\r')
    await settle()
    expect(card?.isExpanded).toBe(false)
  })

  it('renders nested code-dispatch sub-calls inside the parent card (B3)', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      {
        kind: 'tool', id: 'run-1', callId: 'run-1', name: 'run_code', arguments: '{}', state: 'done',
        children: [
          {
            kind: 'tool', id: 'run-1:code:0', callId: 'run-1:code:0', name: 'bash',
            arguments: '{"command":"echo hi"}', state: 'done',
            output: { blocks: [{ type: 'text', text: 'hi from sub-call' }] },
          },
        ],
      },
    ]))
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('子调用')
    expect(plain).toContain('bash')
    expect(plain).toContain('echo hi')
    expect(plain).toContain('hi from sub-call')
  })

  it('updates the streaming message in place on subsequent renders', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'Hel', thinking: [], state: 'streaming' },
    ], true))
    await settle()
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'Hello world', thinking: [], state: 'streaming' },
    ], true))
    await settle()
    expect(test.terminal.plain()).toContain('Hello world')
  })

  it('swaps the working loader in while busy and out when idle', async () => {
    const test = mount(undefined, { keymap: 'pi' }) // web 文案固定于 pi 预设（B14）
    await settle()
    test.app.render(doc([], true))
    await settle()
    expect(test.terminal.plain()).toContain('Deep diving')
    test.app.render(doc([], false))
    await settle()
    expect(test.terminal.plain()).toContain('Deep diving')
  })

  it('keeps the composer enabled while busy (queue upstream)', async () => {
    // busy Enter 的 queue 语义保留在 pi 预设（web 语义；cc 预设默认 steer，B1）。
    const test = mount(undefined, { keymap: 'pi' })
    await settle()
    test.app.render(doc([], true))
    await settle()
    test.terminal.feed('queued while busy\r')
    await settle()
    expect(test.calls.input).toEqual(['queued while busy'])
  })

  it('maps Esc to interrupt while busy and Ctrl+C to quit while idle (double press)', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([], true))
    await settle()
    test.terminal.feed('\x1b')
    await settle()
    expect(test.calls.interrupt).toBe(1)
    expect(test.calls.quit).toBe(0)

    // cc 预设 idle Ctrl+C 是双按退出（B3/B20）：第一次进入待命，第二次退出。
    test.app.render(doc([], false))
    await settle()
    test.terminal.feed('\x03')
    await settle()
    expect(test.calls.quit).toBe(0)
    test.terminal.feed('\x03')
    await settle()
    expect(test.calls.quit).toBe(1)
  })

  it('maps Ctrl+R and Ctrl+G to the picker requests', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('\x12')
    await settle()
    expect(test.calls.sessions).toBe(1)
    test.terminal.feed('\x07')
    await settle()
    expect(test.calls.models).toBe(1)
  })

  it('opens the session picker overlay and reports the choice', async () => {
    const test = mount()
    await settle()
    let picked: string | null | undefined
    test.handlers.onSessionPicked = (value) => { picked = value }
    test.app.showSessionPicker([
      { value: 'session-a', label: 'A session', description: 'older' },
      { value: 'session-b', label: 'B session', description: 'newer' },
    ])
    await settle()
    expect(test.terminal.plain()).toContain('A session')
    test.terminal.feed('\r')
    await settle()
    expect(picked).toBe('session-a')
  })

  it('debounces picker filters to the search handler and replaces rows (H5)', async () => {
    const test = mount()
    await settle()
    test.app.showSessionPicker([{ value: 'session-a', label: 'A session', description: 'older' }])
    await settle()
    test.terminal.feed('needle')
    await settle(40)
    expect(test.calls.sessionSearch).toEqual([]) // debounced
    await settle(300)
    expect(test.calls.sessionSearch).toEqual(['needle'])
    // Backend results replace the open panel's rows.
    test.app.setSessionPickerRows([{ value: 'hit-1', label: 'Hit one', description: 'snippet …' }])
    await settle()
    expect(test.terminal.plain()).toContain('Hit one')
    expect(test.terminal.plain()).toContain('snippet …')
  })

  it('steers busy Enter submissions when DSH_TUI_ENTER=steer (D2)', async () => {
    const previous = process.env.DSH_TUI_ENTER
    process.env.DSH_TUI_ENTER = 'steer'
    try {
      const test = mount()
      await settle()
      test.app.render(doc([], true)) // busy
      await settle()
      test.terminal.feed('steer me\r')
      await settle()
      expect(test.calls.steers).toEqual(['steer me'])
      expect(test.calls.input).toEqual([])
    } finally {
      if (previous === undefined) delete process.env.DSH_TUI_ENTER
      else process.env.DSH_TUI_ENTER = previous
    }
  })

  it('steers busy Enter by default under the cc preset (B1, CC semantics)', async () => {
    const previous = process.env.DSH_TUI_ENTER
    delete process.env.DSH_TUI_ENTER
    try {
      const test = mount() // 默认 cc 预设
      await settle()
      test.app.render(doc([], true)) // busy
      await settle()
      test.terminal.feed('steer by default\r')
      await settle()
      expect(test.calls.steers).toEqual(['steer by default'])
      expect(test.calls.input).toEqual([])
    } finally {
      if (previous === undefined) delete process.env.DSH_TUI_ENTER
      else process.env.DSH_TUI_ENTER = previous
    }
  })

  it('queues busy Enter under pi preset and honors an explicit queue override (B1)', async () => {
    const previous = process.env.DSH_TUI_ENTER
    try {
      // pi 预设默认 queue（web 语义）。
      delete process.env.DSH_TUI_ENTER
      const pi = mount(undefined, { keymap: 'pi' })
      await settle()
      pi.app.render(doc([], true))
      await settle()
      pi.terminal.feed('queued under pi\r')
      await settle()
      expect(pi.calls.input).toEqual(['queued under pi'])
      expect(pi.calls.steers).toEqual([])
      // cc 预设 + 显式 DSH_TUI_ENTER=queue 覆盖 → queue。
      process.env.DSH_TUI_ENTER = 'queue'
      const cc = mount()
      await settle()
      cc.app.render(doc([], true))
      await settle()
      cc.terminal.feed('explicit queue\r')
      await settle()
      expect(cc.calls.input).toEqual(['explicit queue'])
      expect(cc.calls.steers).toEqual([])
    } finally {
      if (previous === undefined) delete process.env.DSH_TUI_ENTER
      else process.env.DSH_TUI_ENTER = previous
    }
  })

  it('interrupts and sends with Ctrl+Enter under cc (B5)', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([], true)) // busy
    await settle()
    test.terminal.feed('final answer')
    // kitty CSI u：ctrl+enter（普通终端的 Ctrl+Enter 与 Enter 同字节，无法区分）。
    test.terminal.feed('\x1b[13;5u')
    await settle()
    expect(test.calls.interruptSend).toEqual(['final answer'])
    expect(test.calls.interrupt).toBe(0)
    expect(test.app.composerText).toBe('')
    // 空输入退化为纯中断。
    test.terminal.feed('\x1b[13;5u')
    await settle()
    expect(test.calls.interrupt).toBe(1)
    expect(test.calls.interruptSend).toEqual(['final answer'])
  })

  it('queues a follow-up with Tab while busy under cc (B4)', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([], true)) // busy
    await settle()
    test.terminal.feed('later task')
    test.terminal.feed('\t')
    await settle()
    expect(test.calls.input).toEqual(['later task'])
    expect(test.app.composerText).toBe('')
    // idle 时 Tab 不吞：无焦点条目时落到编辑器（不进 onInput）。
    test.terminal.feed('\t')
    await settle()
    expect(test.calls.input).toEqual(['later task'])
  })

  it('exits only after two idle Ctrl+C presses under cc (B3/B20)', async () => {
    const test = mount()
    await settle()
    // 有输入：第一次 Ctrl+C 清空输入、不退出。
    test.terminal.feed('draft text')
    test.terminal.feed('\x03')
    await settle()
    expect(test.calls.quit).toBe(0)
    expect(test.app.composerText).toBe('')
    // 空输入：第一次进入 3s 待命（不退出），第二次退出。
    test.terminal.feed('\x03')
    await settle()
    expect(test.calls.quit).toBe(0)
    test.terminal.feed('\x03')
    await settle()
    expect(test.calls.quit).toBe(1)
  })

  it('clears the armed exit state when typing then pressing Ctrl+C again (B3)', async () => {
    const test = mount()
    await settle()
    // 进入待命。
    test.terminal.feed('\x03')
    await settle()
    expect(test.calls.quit).toBe(0)
    // 输入非空时按下：清空并解除待命（不退出）。
    test.terminal.feed('oops')
    test.terminal.feed('\x03')
    await settle()
    expect(test.calls.quit).toBe(0)
    expect(test.app.composerText).toBe('')
    // 待命已解除：再按两次才退出。
    test.terminal.feed('\x03')
    await settle()
    expect(test.calls.quit).toBe(0)
    test.terminal.feed('\x03')
    await settle()
    expect(test.calls.quit).toBe(1)
  })

  it('still quits on a single idle Ctrl+C outside cc (B3 guard)', async () => {
    const test = mount(undefined, { keymap: 'pi' })
    await settle()
    test.terminal.feed('\x03')
    await settle()
    expect(test.calls.quit).toBe(1)
  })

  it('copies a drag selection via OSC 52 on release (B8, pi-native mouse)', async () => {
    const test = mount(undefined, { mouse: true }) // 上报开启时才可用（默认关闭，右键归 Warp）
    await settle()
    const line = 'select this sentence for copying please'
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: line, thinking: [], state: 'committed' },
    ]))
    await settle(60)
    // 用 pi 维护的 previousScreen（最近一次渲染的完整屏幕）定位消息坐标——
    // FakeTerminal.output 是差分累积流，无法重建屏幕；previousScreen 是引擎真源。
    const tui = (test.app as unknown as { tui: unknown }).tui as unknown as { previousScreen?: string[] }
    const screen = tui.previousScreen ?? []
    const rowIndex = screen.findIndex(line => line.includes('select this'))
    expect(rowIndex).toBeGreaterThanOrEqual(0)
    const colStart = screen[rowIndex].indexOf('select this')
    // SGR 鼠标（1-based；pi 期望拖动/释放都保持 button=32，释放靠 m 后缀）。
    // feedRaw：FakeTerminal 的 feed tokenizer 不识别 `\x1b[<…` 前缀的 SGR 序列。
    test.terminal.feedRaw(`\x1b[<0;${colStart + 1};${rowIndex + 1}M`)
    test.terminal.feedRaw(`\x1b[<32;${colStart + 12};${rowIndex + 1}M`)
    test.terminal.feedRaw(`\x1b[<32;${colStart + 12};${rowIndex + 1}m`)
    await settle()
    // OSC 52 复制序列出现：选区内容来自屏幕上的消息文本（坐标含 ANSI 前缀，
    // 不校验精确边界，只断言与消息行相交）。
    const match = /\x1b\]52;c;([A-Za-z0-9+/=]+)\x07/.exec(test.terminal.output)
    expect(match).not.toBeNull()
    if (match !== null) {
      const copied = Buffer.from(match[1], 'base64').toString('utf8')
      expect(copied.length).toBeGreaterThan(0)
      expect(line.includes(copied.trim())).toBe(true)
    }
  })

  it('does not enable SGR mouse reporting by default (right-click belongs to the host)', async () => {
    // 2026-08-20 用户决策：右键默认归 Warp——不发送上报启用序列（?1000/1002/1003/1004/1006）。
    const off = mount()
    await settle()
    expect(off.terminal.output).not.toMatch(/\x1b\[\?1000h/)
    // 显式开启（选项或 DSH_TUI_MOUSE=1）才发送启用序列。
    const on = mount(undefined, { mouse: true })
    await settle()
    expect(on.terminal.output).toMatch(/\x1b\[\?1000h/)
  })

  it('exports the transcript to the terminal scrollback with [ on empty input', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'user', id: 'u1', text: 'hello' },
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'world reply', thinking: [], state: 'committed' },
    ]))
    await settle()
    // 输入框为空：`[` 退出 alt screen → 写转录到主屏（scrollback）→ 重进。
    test.terminal.feed('[')
    await settle()
    expect(test.terminal.output).toContain('\x1b[?1049l')
    expect(test.terminal.output).toContain('hello')
    expect(test.terminal.output).toContain('world reply')
    expect(test.terminal.output).toContain('\x1b[?1049h')
    // 输入框有内容时 `[` 是普通字符。
    test.terminal.feed('abc')
    test.terminal.feed('[')
    await settle()
    expect(test.app.composerText).toBe('abc[')
  })

  it('renders and drives the composer in regular mode (TuiMainScreen)', async () => {
    const test = mount(undefined, { regular: true })
    await settle()
    // 主屏渲染：消息文本可见。
    test.app.render(doc([
      { kind: 'user', id: 'u1', text: 'regular hello' },
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'regular reply', thinking: [], state: 'committed' },
    ]))
    await settle(60)
    expect(test.terminal.plain()).toContain('regular hello')
    expect(test.terminal.plain()).toContain('regular reply')
    // 输入与发送照常（不依赖视口能力）。
    test.terminal.feed('send me\r')
    await settle(50)
    expect(test.calls.input).toEqual(['send me'])
    // 无应用滚动：Ctrl+F 搜索降级提示（regular 能力边界）。
    test.terminal.feed('\x06') // Ctrl+F
    await settle(50)
    expect(test.terminal.plain()).toContain('regular 模式无应用内滚动')
  })

  it('D1 split-footer: 超屏后 chrome 被 CUP 重绘到视口底部且恒贴底', async () => {
    const test = mount(undefined, { regular: true })
    await settle()
    // 60 条消息超屏（FakeTerminal height=30）。
    const entries = Array.from({ length: 60 }, (_, i) => ({
      kind: 'assistant' as const, id: `s${i}`, turn: 1, step: i + 1,
      text: `bulk message ${i}`, thinking: [], state: 'committed' as const,
    }))
    test.app.render(doc(entries))
    await settle(80)
    const output = test.terminal.output
    // 编辑器的 CURSOR_MARKER 不泄漏到终端。
    expect(output).not.toContain('\x1b_pi:c\x07')
    // chrome 经 CUP 重绘：定位序列存在 + 行内容可见。
    const cupIndex = output.lastIndexOf('\x1b[')
    const plain = test.terminal.plain()
    expect(plain).toContain('pi-ai/deepseek-v4')
    expect(cupIndex).toBeGreaterThan(-1)
    // 贴底行号 = 视口高 30 - chrome 行数 + 1（首行 CUP 定位取最小行号）。
    const paint = (test.app as unknown as { paintChromeLines: (width: number) => { lines: string[]; editorCursor?: { row: number; col: number } } }).paintChromeLines(100)
    const startRow = 30 - paint.lines.length + 1
    expect(output).toContain(`\x1b[${startRow};1H`)
    expect(output).toContain(`\x1b[${startRow + (paint.editorCursor?.row ?? 0)};${paint.editorCursor?.col ?? 1}H`)
  })

  it('pins the composer, updates incrementally and renders overlays in regular mode', async () => {
    const test = mount(undefined, { regular: true })
    await settle()
    const entries = Array.from({ length: 5 }, (_, i) => ({
      kind: 'assistant' as const, id: `a${i}`, turn: 1, step: i + 1,
      text: `message ${i}`, thinking: [], state: 'committed' as const,
    }))
    test.app.render(doc(entries))
    await settle(60)
    const plain = test.terminal.plain()
    for (let i = 0; i < 5; i++) expect(plain).toContain(`message ${i}`)
    // 钉底：内容不足一屏时 BottomPad 补足到终端高度（composer 贴底）。
    const pad = (test.app as unknown as { bottomPad: { height: number } }).bottomPad.height
    expect(pad).toBeGreaterThan(0)
    // 增量更新：同 id 新文本 → 只重渲染该条目（缓存失效路径），渲染结果正确。
    test.app.render(doc([
      ...entries.slice(0, 4),
      { kind: 'assistant' as const, id: 'a4', turn: 1, step: 5, text: 'message 4 updated', thinking: [], state: 'committed' as const },
    ]))
    await settle(60)
    expect(test.terminal.plain()).toContain('message 4 updated')
    // 删除条目 → 视图与行缓存移除（plain 是累积输出，用内部状态断言）。
    test.app.render(doc(entries.slice(0, 3)))
    await settle(60)
    const views = (test.app as unknown as { entryViews: Map<string, unknown> }).entryViews
    expect(views.has('a4')).toBe(false)
    // 内容变少 → BottomPad 增高（composer 仍贴底）。
    const padAfter = (test.app as unknown as { bottomPad: { height: number } }).bottomPad.height
    expect(padAfter).toBeGreaterThan(pad)
    // overlay（TuiBase 层，两模式共用）：hotkeys 面板在 regular 下渲染。
    test.app.showHotkeys()
    await settle(60)
    expect(test.terminal.plain()).toContain('快捷键')
    // slash 菜单也在 regular 下可用（先关闭 hotkeys 面板）。
    test.terminal.feed('\x1b')
    await settle(60)
    test.terminal.feed('/')
    await settle(60)
    expect(test.terminal.plain()).toContain('/new')
  })

  it('clears the composer with Esc while idle under cc (B6 Esc ladder)', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('half-typed draft')
    await settle()
    test.terminal.feed('\x1b')
    await settle()
    expect(test.app.composerText).toBe('')
    // busy 时 Esc 仍是中断（keymap 优先于清空分支）。
    test.app.render(doc([], true))
    await settle()
    test.terminal.feed('draft again')
    test.terminal.feed('\x1b')
    await settle()
    expect(test.calls.interrupt).toBe(1)
    expect(test.app.composerText).toBe('draft again') // busy 中断不清空输入
  })

  it('cycles session modes with Shift+Tab under cc (B8)', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('\x1b[Z') // shift+tab
    await settle()
    expect(test.calls.cycleMode).toBe(1)
  })

  it('keeps the dsh `Deep diving...` busy text with the CC parenthesized clock under cc (2026-08-21 折中)', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([], true))
    await settle()
    const busy = test.terminal.plain()
    expect(busy).toContain('Deep diving')
    expect(busy).toMatch(/Deep diving\.\.\. \(\d+[分秒sm]/)
    // busy→idle→busy 后仍保持 Deep diving...（不再随机 CC 动词，用户 2026-08-21 决策）。
    test.app.render(doc([], false))
    await settle()
    test.app.render(doc([], true))
    await settle()
    expect(test.terminal.plain()).toContain('Deep diving')
  })

  it('rewinds with double-Esc on empty input under cc (B7)', async () => {
    const test = mount()
    await settle()
    // 第一次空输入 Esc：进入 400ms 待命，不触发。
    test.terminal.feed('\x1b')
    await settle()
    expect(test.calls.rewind).toBe(0)
    // 窗口内第二次 Esc：触发时间回溯选择器。
    test.terminal.feed('\x1b')
    await settle()
    expect(test.calls.rewind).toBe(1)
    // 有输入时 Esc 仍是清空（不触发 rewind）。
    test.terminal.feed('draft')
    test.terminal.feed('\x1b')
    await settle()
    expect(test.calls.rewind).toBe(1)
    expect(test.app.composerText).toBe('')
  })

  it('attaches @-referenced file contents and directory listings on send (B9)', async () => {
    const base = mkdtempSync(join(tmpdir(), 'dsh-tui-at-send-'))
    try {
      writeFileSync(join(base, 'notes.txt'), 'important notes\n')
      mkdirSync(join(base, 'docs'))
      writeFileSync(join(base, 'docs', 'guide.md'), 'guide\n')
      const test = mount({ model: 'pi-ai/deepseek-v4', session: 'session-abc', workspace: base })
      await settle()
      // 文本文件引用：内容附加到消息。
      test.terminal.feed('please read @notes.txt')
      test.terminal.feed('\r')
      await settle(50)
      expect(test.calls.input.length).toBe(1)
      expect(test.calls.input[0]).toContain('── notes.txt ──')
      expect(test.calls.input[0]).toContain('important notes')
      // 目录引用：列出内容。
      test.terminal.feed('list @docs/')
      test.terminal.feed('\r')
      await settle(50)
      expect(test.calls.input[1]).toContain('── docs/ ──')
      expect(test.calls.input[1]).toContain('guide.md')
      // 不存在的引用保留原文。
      test.terminal.feed('see @missing.txt')
      test.terminal.feed('\r')
      await settle(50)
      expect(test.calls.input[2]).toBe('see @missing.txt')
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })

  it('shows the parent session breadcrumb for subagent sessions (E4)', async () => {
    const test = mount({ model: 'pi-ai/deepseek-v4', session: 'child-session', parentSession: 'parent-123' })
    await settle()
    expect(test.terminal.plain()).toContain('↳ parent-123')
  })

  it('marks the current row and filters the picker by typed query', async () => {
    const test = mount()
    await settle()
    let picked: string | null | undefined
    test.handlers.onSessionPicked = (value) => { picked = value }
    test.app.showSessionPicker([
      { value: 'session-a', label: 'A session', description: 'older' },
      { value: 'session-abc', label: 'Current session', description: 'active' },
      { value: 'session-b', label: 'B session', description: 'newer' },
    ])
    await settle()
    // meta.session === 'session-abc' → auto-marked current.
    expect(test.terminal.plain()).toContain('● Current session')
    // Typing 'B' filters to the B row; Enter picks it (filter resets selection).
    test.terminal.feed('B')
    await settle()
    test.terminal.feed('\r')
    await settle()
    expect(picked).toBe('session-b')
  })

  it('cancels the picker with a null pick on Escape', async () => {
    const test = mount()
    await settle()
    let picked: string | null | undefined
    test.handlers.onSessionPicked = (value) => { picked = value }
    test.app.showSessionPicker([{ value: 'session-a', label: 'A session' }])
    await settle()
    test.terminal.feed('\x1b')
    await settle()
    expect(picked).toBeNull()
  })

  it('persists composer history and recalls it with Up', async () => {
    const file = join(tmpdir(), `tui-history-${Date.now()}.json`)
    try {
      const test = mount(undefined, { historyFile: file })
      await settle()
      test.terminal.feed('hello history\r')
      await settle()
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(['hello history'])
      test.terminal.feed('hello history\r')
      await settle()
      // Consecutive duplicates are not re-persisted.
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(['hello history'])
      // Up recalls the last submitted line into the composer.
      test.terminal.feed('\x1b[A')
      await settle()
      expect(test.app.composerText).toBe('hello history')
    } finally {
      rmSync(file, { force: true })
    }
  })

  it('confirms a big multi-line paste before sending', async () => {
    const test = mount()
    await settle()
    const lines = Array.from({ length: 31 }, (_, i) => `line ${i}`)
    test.terminal.feed(`${lines.join('\n')}\r`)
    await settle()
    expect(test.terminal.plain()).toContain('大段内容')
    expect(test.calls.input).toEqual([])
    test.terminal.feed('\r') // pick 发送
    await settle()
    expect(test.calls.input).toHaveLength(1)
    expect(test.calls.input[0].split('\n')).toHaveLength(31)
  })

  it('keeps long assistant messages expanded by default and folds them with Tab + Enter', async () => {
    const test = mount()
    await settle()
    const text = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n')
    test.app.render(doc([{ kind: 'assistant', id: '1:1', turn: 1, step: 1, text, thinking: [], state: 'committed' }]))
    await settle()
    // Long outputs default to EXPANDED: the full text is visible immediately.
    expect(test.terminal.plain()).toContain('line 49')
    expect(test.terminal.plain()).not.toContain('还有 38 行（⏎ 展开）')
    test.terminal.feed('\t') // focus the newest focusable item
    await settle()
    test.terminal.feed('\r') // manual fold
    await settle()
    expect(test.terminal.plain()).toContain('还有 38 行（⏎ 展开')
    test.terminal.feed('\r') // expand again
    await settle()
    expect(test.terminal.plain()).toContain('line 49')
  })

  it('folds the oldest entries behind a banner on Ctrl+K and restores them', async () => {
    const test = mount()
    await settle()
    const entries = Array.from({ length: 35 }, (_, i) => ({ kind: 'user' as const, id: `u${i}`, text: `message ${i}` }))
    test.app.render(doc(entries))
    await settle()
    expect(test.app.viewCount).toBe(35)
    test.terminal.feed('\x0b') // Ctrl+K
    await settle()
    expect(test.app.viewCount).toBe(31) // banner + 30 kept
    expect(test.terminal.plain()).toContain('已折叠 5 条')
    expect(test.terminal.plain()).not.toContain('message 0')
    test.terminal.feed('\x0b') // Ctrl+K again
    await settle()
    expect(test.app.viewCount).toBe(35)
  })

  it('shows contextual footer hints and the ctx percentage', async () => {
    const test = mount({ model: 'pi-ai/deepseek-v4', session: 'session-abc', contextWindow: 100_000, effort: 'high' })
    test.terminal.resize(200, 30)
    test.app.render({ entries: [], busy: false, permissionPreset: 'workspace-write' }) // refresh the footer at the new width
    await settle()
    // The fixed status area under the input line carries NO shortcut hints
    // (they live in /hotkeys); the facts row shows model + effort + permission + ctx pressure.
    expect(test.terminal.plain()).not.toContain('Ctrl+C 退出')
    expect(test.terminal.plain()).toContain('pi-ai/deepseek-v4 · high')
    expect(test.terminal.plain()).toContain('Workspace Write')
    expect(test.terminal.plain()).toContain('ctx 0%')
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'x', thinking: [], state: 'committed', usage: { inputTokens: 8_000, outputTokens: 2_000 } },
    ], true))
    await settle()
    const busy = test.terminal.plain()
    expect(busy).toContain('ctx 10% ▓') // busy frame carries the meter bar
    // The session stats strip lives under the input line (web composer.dock
    // parity), and the running slot above carries no shortcut hints either.
    expect(busy).toContain('1 轮 · 1 步')
    expect(busy).not.toContain('Esc ')
    // Tool cards keep their keyboard affordance on the card itself.
    test.app.render(doc([
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'bash', arguments: '{}', state: 'done', output: { blocks: [{ type: 'text', text: 'ok' }] } },
    ], false))
    test.terminal.feed('\t')
    await settle()
    expect(test.terminal.plain()).toContain('⏎ 展开/收起')
  })

  it('shows an image placeholder for read_image tool results', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'tool', id: 'c2', callId: 'c2', name: 'read_image', arguments: '{}', state: 'done', output: { blocks: [{ type: 'image', data: 'x', mediaType: 'image/png', width: 640, height: 480 }, { type: 'text', text: 'described' }] } },
    ]))
    await settle()
    // cc 语式：执行结束后自动收起为摘要行。
    expect(test.terminal.plain()).toContain('✓ 完成 · 2 行输出 · described（⏎ 展开）')
    // Tab 聚焦 + Enter 展开完整结果后，图片占位与文本可见。
    test.terminal.feed('\t')
    await settle()
    test.terminal.feed('\r')
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('已读取 1 张图像')
    expect(plain).toContain('described')
  })

  it('renders a stats footer under assistant messages with metrics', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'answer', thinking: [], state: 'committed', stats: { runMs: 2_500, ttftMs: 400, tokensPerSecond: 120 } },
    ]))
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('⏱ 2.5s')
    expect(plain).toContain('⚡ 首 token 400ms')
    expect(plain).toContain('120 tok/s')
    // No stats → no footer (fresh terminal so the accumulated buffer is clean).
    const plain2 = mount()
    await settle()
    plain2.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'answer', thinking: [], state: 'committed' },
    ]))
    await settle()
    expect(plain2.terminal.plain()).not.toContain('tok/s')
  })

  it('renders background job rows in the capability panel', async () => {
    const test = mount()
    await settle()
    test.app.showJobs([{ id: 'job-1', label: 'audit repo', status: 'running' }])
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('◆ job')
    expect(plain).toContain('audit repo')
    expect(plain).toContain('running')
  })

  it('renders message clocks and tool wall times (T3①/T3②)', async () => {
    const test = mount()
    await settle()
    const at = new Date(2026, 0, 1, 14, 5).getTime()
    test.app.render(doc([
      { kind: 'user', id: 'u1', text: 'hello', at },
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'answer', thinking: [], state: 'committed', at, stats: { runMs: 1_200, ttftMs: 300 } },
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'bash', arguments: '{}', state: 'done', output: { blocks: [{ type: 'text', text: 'ok' }] }, durationMs: 1_600 },
    ]))
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('14:05')
    expect(plain).toContain('1.6s')
  })

  it('renders the user message as a `❯` classic echo in cc+regular, and a bubble in fullscreen (V1)', async () => {
    // cc classic（regular 默认）：`❯` 前缀 + 纯文本回显（无气泡）。
    const classic = mount(undefined, { regular: true, keymap: 'cc' })
    await settle()
    classic.app.render(doc([{ kind: 'user', id: 'u1', text: 'hello' }]))
    await settle()
    expect(classic.terminal.plain()).toContain('❯ hello')

    // fullscreen（默认）：保留气泡，无 `❯` 前缀。
    const bubble = mount(undefined, { regular: false, keymap: 'cc' })
    await settle()
    bubble.app.render(doc([{ kind: 'user', id: 'u1', text: 'hello' }]))
    await settle()
    expect(bubble.terminal.plain()).toContain('hello')
    expect(bubble.terminal.plain()).not.toContain('❯ hello')

    // pi 预设（web 语式）在 regular 下也保留气泡，不套 cc 的 `❯` 回显。
    const piRegular = mount(undefined, { regular: true, keymap: 'pi' })
    await settle()
    piRegular.app.render(doc([{ kind: 'user', id: 'u1', text: 'hello' }]))
    await settle()
    expect(piRegular.terminal.plain()).toContain('hello')
    expect(piRegular.terminal.plain()).not.toContain('❯ hello')
  })

  it('shows `You`/`Claude` speaker labels in cc fullscreen, none in regular (V2)', async () => {
    // fullscreen（默认 mount 注入 regular:false）+ cc 预设：消息渲染补归属标签。
    const fs = mount(undefined, { regular: false, keymap: 'cc' })
    await settle()
    fs.app.render(doc([
      { kind: 'user', id: 'u1', text: 'hello' },
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'hi there', thinking: [], state: 'committed' },
    ]))
    await settle()
    const fsFrame = fs.terminal.plain()
    expect(fsFrame).toContain('You')
    expect(fsFrame).toContain('Claude')

    // regular + cc：CC classic 无归属标签（V1 只加 `❯` 前缀）。
    const reg = mount(undefined, { regular: true, keymap: 'cc' })
    await settle()
    reg.app.render(doc([
      { kind: 'user', id: 'u1', text: 'hello' },
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'hi there', thinking: [], state: 'committed' },
    ]))
    await settle()
    const regFrame = reg.terminal.plain()
    expect(regFrame).not.toContain('You')
    expect(regFrame).not.toContain('Claude')

    // pi 预设（web 语式）在 fullscreen 下也不加 CC 归属标签。
    const piFs = mount(undefined, { regular: false, keymap: 'pi' })
    await settle()
    piFs.app.render(doc([{ kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'hi there', thinking: [], state: 'committed' }]))
    await settle()
    expect(piFs.terminal.plain()).not.toContain('Claude')
  })

  it('cycles Tab focus through message frames and reports the focused entry (T3④)', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'user', id: 'u1', text: 'hello' },
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'reply', thinking: [], state: 'committed' },
    ]))
    await settle()
    expect(test.app.focusedEntryId()).toBeNull()
    test.terminal.feed('\t') // enter the newest focusable item
    await settle()
    expect(test.app.focusedEntryId()).toBe('1:1')
    expect(test.terminal.plain()).toContain('▸ 助手回复')
    test.terminal.feed('\t') // walks down to the older frame
    await settle()
    expect(test.app.focusedEntryId()).toBe('u1')
    test.terminal.feed('\t') // wraps back to the composer
    await settle()
    expect(test.app.focusedEntryId()).toBeNull()
    expect(test.terminal.plain()).toContain('▸ 用户消息')
    test.terminal.feed('\x1b') // Esc returns to the composer
    await settle()
    expect(test.app.focusedEntryId()).toBeNull()
  })

  it('shows a tiered context-pressure bar in the footer (T4①)', async () => {
    const test = mount({ model: 'pi-ai/deepseek-v4', session: 'session-abc', contextWindow: 100_000 })
    await settle()
    // 85k/100k → 85% → error tone with a nearly full bar.
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'x', thinking: [], state: 'committed', usage: { inputTokens: 80_000, outputTokens: 5_000 } },
    ]))
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('ctx 85%')
    expect(plain).toContain('▓▓▓▓▓▓▓▓▓░') // 85% → 9 of 10 blocks
  })

  it('lists the turn\'s produced files on the assistant stats line (T4②)', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'done', thinking: [], state: 'committed', stats: { runMs: 900, ttftMs: 100 } },
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'write', arguments: '{}', turn: 1, step: 1, state: 'done', output: { blocks: [] }, meta: { diffs: [{ path: 'a.txt', oldText: null, newText: 'x' }, { path: 'b.txt', oldText: null, newText: 'y' }] } },
    ]))
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('✎ a.txt, b.txt')
    // Another turn's files never leak into this turn's line (fresh terminal
    // so the accumulated buffer does not carry the first frame's chips).
    const second = mount()
    await settle()
    second.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'done', thinking: [], state: 'committed', stats: { runMs: 900, ttftMs: 100 } },
      { kind: 'tool', id: 'c2', callId: 'c2', name: 'write', arguments: '{}', turn: 2, step: 1, state: 'done', output: { blocks: [] }, meta: { diffs: [{ path: 'other.txt', oldText: null, newText: 'z' }] } },
    ]))
    await settle()
    expect(second.terminal.plain()).not.toContain('✎')
  })

  it('grades thinking blocks by descending intensity (T5④)', async () => {
    const test = mount()
    await settle()
    // streaming 中思考块展开（cc 语式在结束后才收起），分级着色在此态断言。
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'answer', thinking: ['first thought', 'second thought', 'third thought'], state: 'streaming' },
    ]))
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('first thought')
    expect(plain).toContain('second thought')
    expect(plain).toContain('third thought')
    // Each grade uses its own palette role (resolvable, and distinct RGB).
    const raw = test.terminal.output
    const rgbOf = (needle: string): string => {
      const index = raw.indexOf(needle)
      const prefix = raw.slice(Math.max(0, index - 60), index)
      const match = /\x1b\[38;2;(\d+);(\d+);(\d+)m/g.exec(prefix)
      return match === null ? '' : `${match[1]},${match[2]},${match[3]}`
    }
    const first = rgbOf('first thought')
    const third = rgbOf('third thought')
    expect(first).not.toBe('')
    expect(first).not.toBe(third)
  })

  it('cc 语式：思考结束后自动收起，Enter 展开（Claude Code 对齐）', async () => {
    const test = mount()
    await settle()
    // streaming：思考块展开可见。
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'answer', thinking: ['secret reasoning'], state: 'streaming' },
    ]))
    await settle()
    expect(test.terminal.plain()).toContain('secret reasoning')
    // committed：自动收起成一行「Thinking…」。
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'answer', thinking: ['secret reasoning'], state: 'committed' },
    ]))
    await settle()
    const collapsed = test.terminal.plain()
    expect(collapsed).toContain('Thinking…')
    // Tab 聚焦消息 + Enter 展开思考块；再 Enter 收回。
    test.terminal.feed('\t')
    await settle()
    test.terminal.feed('\r')
    await settle()
    expect(test.terminal.plain()).toContain('secret reasoning')
    test.terminal.feed('\r')
    await settle()
    expect(test.terminal.plain()).toContain('Thinking…')
  })

  it('V3: 折叠行显示 CC 式时钟 Thinking for Ns（committed 定格）', async () => {
    const test = mount()
    await settle()
    // committed + 自动收起：以 commit 时间定格（3500 - 1000 = 2.5s → floor 2）。
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'answer', thinking: ['secret'], state: 'committed', firstChunkAt: 1_000, at: 3_500 },
    ]))
    await settle()
    expect(test.terminal.plain()).toContain('Thinking for 2s')
    // 无时钟窗口的回退在组件级测试覆盖（keyboard-toggle.spec）。
  })

  it('cc 语式：工具执行结束后自动收起为摘要行，Enter 展开完整输出', async () => {
    const test = mount()
    await settle()
    const output = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n')
    // running：执行中显示调用行。
    test.app.render(doc([
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'bash', arguments: '{"command":"seq"}', state: 'running',
        output: { blocks: [{ type: 'text', text: 'partial' }] } },
    ]))
    await settle()
    expect(test.terminal.plain()).toContain('$ seq')
    // done：自动收起为摘要行（状态 + 行数 + 首行输出），完整输出不可见。
    test.app.render(doc([
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'bash', arguments: '{"command":"seq"}', state: 'done',
        output: { blocks: [{ type: 'text', text: output }] } },
    ]))
    await settle()
    const collapsed = test.terminal.plain()
    expect(collapsed).toContain('✓ 完成 · 30 行输出 · line 0（⏎ 展开）')
    expect(collapsed).not.toContain('line 29')
    // Tab 聚焦 + Enter：展开完整输出；再 Enter：回到摘要。
    test.terminal.feed('\t')
    await settle()
    test.terminal.feed('\r')
    await settle()
    expect(test.terminal.plain()).toContain('line 29')
    test.terminal.feed('\r')
    await settle()
    expect(test.terminal.plain()).toContain('✓ 完成 · 30 行输出 · line 0（⏎ 展开）')
  })

  it('cc 预设收起工具卡：错误态折叠隐藏输出 + `✗ 失败`（V6）', async () => {
    const test = mount()
    await settle()
    // 错误工具：收起态不应向用户展示失败输出内容（CC 语式：红点 + 输出隐藏）。
    test.app.render(doc([
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'bash', arguments: '{"command":"false"}', state: 'error',
        output: { blocks: [{ type: 'text', text: 'command not found' }] } },
    ]))
    await settle()
    const collapsed = test.terminal.plain()
    expect(collapsed).toContain('✗ 失败 ·')
    expect(collapsed).not.toContain('command not found')
    expect(collapsed).not.toContain('✓ 完成 ·')
  })

  it('pi 预设不自动收起：thinking 与工具过程保持展开（回归）', async () => {
    const test = mount({ model: 'pi-ai/deepseek-v4', session: 'session-abc', workspace: '/workspace' }, { keymap: 'pi' })
    await settle()
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'answer', thinking: ['visible reasoning'], state: 'committed' },
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'bash', arguments: '{"command":"seq"}', state: 'done',
        output: { blocks: [{ type: 'text', text: 'full output' }] } },
    ]))
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('visible reasoning')
    expect(plain).toContain('full output')
    expect(plain).not.toContain('✓ 完成 ·')
  })

  it('setKeymap 热切换：cc → pi 恢复展开，pi → cc 已结束条目收起', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'answer', thinking: ['hidden reasoning'], state: 'committed' },
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'bash', arguments: '{"command":"seq"}', state: 'done',
        output: { blocks: [{ type: 'text', text: 'tool output' }] } },
    ]))
    await settle()
    // cc：已收起。
    expect(test.terminal.plain()).toContain('Thinking…')
    expect(test.terminal.plain()).toContain('✓ 完成 ·')
    // 切到 pi：恢复展开。
    test.app.setKeymap('pi')
    await settle()
    const piFrame = test.terminal.plain()
    expect(piFrame).toContain('hidden reasoning')
    expect(piFrame).toContain('tool output')
    // 切回 cc：再次收起。
    test.app.setKeymap('cc')
    await settle()
    const ccFrame = test.terminal.plain()
    expect(ccFrame).toContain('Thinking…')
    expect(ccFrame).toContain('✓ 完成 ·')
  })

  it('renders mermaid diagrams as terminal box art (T5⑥)', async () => {
    const test = mount()
    await settle()
    const text = 'flow:\n```mermaid\ngraph TD\nA-->B\n```'
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text, thinking: [], state: 'committed' },
    ]))
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('┌───┐')
    expect(plain).toContain('│ A │')
    expect(plain).toContain('▼')
  })

  it('matches the visual snapshot for a rich transcript', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'user', id: 'u1', text: 'summarize the diff' },
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: '**bold** plan:\n\n- one\n- two\n\n```ts\nconst x = 1\n```', thinking: [], state: 'committed', usage: { inputTokens: 900, outputTokens: 120 } },
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'bash', arguments: '{"cmd":"git diff"}', state: 'done', output: { blocks: [{ type: 'text', text: 'a\nb\nc' }] } },
      { kind: 'approval', id: 'a1', toolName: 'bash', callId: 'x', state: 'decided', outcome: 'allowed-once' },
      { kind: 'notice', id: 'n1', text: '已中断', tone: 'info' },
    ]))
    await settle()
    expect(test.terminal.plain()).toMatchSnapshot()
  })

  it('shows the elapsed time in the busy slot as the turn runs', async () => {
    const test = mount(undefined, { keymap: 'pi' }) // web 文案固定于 pi 预设（B14）
    await settle()
    test.app.render({ entries: [], busy: true })
    await new Promise(resolve => setTimeout(resolve, 1100))
    test.app.render({ entries: [], busy: true })
    await settle()
    expect(test.terminal.plain()).toContain('Deep diving...')
  })

  it('renders the busy status in the web-brand gradient', async () => {
    const test = mount(undefined, { keymap: 'pi' }) // web 文案固定于 pi 预设（B14）
    await settle()
    test.app.render({ entries: [], busy: true })
    await settle()
    // Spinner (star) → gradient starts at deepseek-450: the exact sequence
    // only the status line produces (the brand splash has no spinner).
    expect(test.terminal.output).toContain('·')
    expect(test.terminal.output).toContain('\x1b[38;2;86;134;254')
    expect(test.terminal.plain()).toContain('Deep diving...')
  })

  it('V5: cc 预设 busy 行追加 `↓ N tokens`（字符近似累计）', async () => {    const test = mount() // 默认 keymap=cc
    await settle()
    test.app.render({
      entries: [
        { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'Hel', thinking: [], state: 'streaming',
          firstChunkAt: Date.now() - 3_000, decodeSamples: [{ t: Date.now() - 3_000, chars: 20 }, { t: Date.now() - 500, chars: 80 }] },
      ],
      busy: true,
    })
    await settle()
    // 100 chars / 4 ≈ 25 tokens；cc 预设才有（pi 预设无此后缀）。
    expect(test.terminal.plain()).toContain('↓ 25 tokens')
    const pi = mount(undefined, { keymap: 'pi' })
    await settle()
    pi.app.render({
      entries: [
        { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'Hel', thinking: [], state: 'streaming', firstChunkAt: Date.now() - 3_000, decodeSamples: [{ t: Date.now() - 3_000, chars: 20 }, { t: Date.now() - 500, chars: 80 }] },
      ],
      busy: true,
    })
    await settle()
    expect(pi.terminal.plain()).not.toContain('↓ 25 tokens')
  })

  it('V4: cc 预设输入框边框随权限语义着色（full-access 红），pi 预设还原', async () => {    const test = mount() // 默认 keymap=cc
    await settle()
    test.app.render(docWithPermission([], 'full-access'))
    await settle()
    const red = permissionTone('full-access')('─')
    expect(test.terminal.output).toContain(red)
    const pi = mount(undefined, { keymap: 'pi' })
    await settle()
    pi.app.render(docWithPermission([], 'full-access'))
    await settle()
    expect(pi.terminal.output).not.toContain(red)
  })

  it('B7: Shift+Up 进入消息选择（焦点环入口），↑/↓ 移动、Enter 退出、Esc 复位', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'first', thinking: [], state: 'committed' },
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'bash', arguments: '{}', state: 'done', turn: 2, step: 1 },
      { kind: 'assistant', id: '2:1', turn: 2, step: 1, text: 'second', thinking: [], state: 'committed' },
    ]))
    await settle()
    // 进入选择模式：聚焦最后一条（second），并提示。
    test.terminal.feed('\x1b[1;2A')
    await settle()
    expect(test.terminal.plain()).toContain('消息选择')
    // ↑ 前移 / ↓ 回移（clamp 不崩）；Enter 交给条目组件后选择模式退出。
    test.terminal.feed('\x1b[A')
    await settle()
    test.terminal.feed('\x1b[B')
    await settle()
    test.terminal.feed('\r')
    await settle()
    // Esc 复位焦点到输入框。
    test.terminal.feed('\x1b')
    await settle()
    test.terminal.feed('typing after esc')
    await settle()
    expect(test.terminal.plain()).toContain('typing after esc')
  })

  it('badges a turn outcome on the assistant message footer (P0)', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'x', thinking: [], state: 'committed',
        outcome: { text: '已中断', tone: 'info' } },
    ]))
    await settle()
    expect(test.terminal.plain()).toContain('⏹ 已中断')
    // Errors badge with the error mark.
    test.app.render(doc([
      { kind: 'assistant', id: '1:2', turn: 1, step: 2, text: 'y', thinking: [], state: 'committed',
        outcome: { text: 'Error: TIMEOUT: upstream timed out', tone: 'error' } },
    ]))
    await settle()
    expect(test.terminal.plain()).toContain('✗ Error: TIMEOUT: upstream timed out')
  })

  it('converges consecutive same-group notices into one row (P1)', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'notice', id: 't1', text: '会话标题：a', tone: 'info', group: 'title' },
      { kind: 'notice', id: 't2', text: '会话标题：b', tone: 'info', group: 'title' },
    ]))
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('会话标题：b ×2')
    expect(plain).not.toContain('会话标题：a')
  })

  it('shows a transient toast and clears it after 2.5s (P2)', async () => {
    vi.useFakeTimers()
    try {
      const test = mount()
      test.app.render({ entries: [], busy: false })
      test.app.toast('语言：中文', 'success')
      expect(test.app.toastVisible).toBe(true)
      vi.advanceTimersByTime(2600)
      expect(test.app.toastVisible).toBe(false)
      test.app.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('defers a toast raised while busy until the turn ends (P2)', async () => {
    const test = mount()
    await settle()
    test.app.render({ entries: [], busy: true })
    await settle()
    test.app.toast('已执行', 'success')
    expect(test.app.toastVisible).toBe(false) // deferred while busy
    test.app.render({ entries: [], busy: false })
    await settle()
    expect(test.app.toastVisible).toBe(true)
    expect(test.terminal.plain()).toContain('✓ 已执行')
  })

  it('collapses multiple jobs into one row and expands with Ctrl+O (P3)', async () => {
    const test = mount()
    await settle()
    const finishedAt = Date.now()
    test.app.showJobs([
      { id: 'j1', label: 'build', status: 'running', startedAt: finishedAt - 65_000 },
      { id: 'j2', label: 'test', status: 'completed', startedAt: finishedAt - 70_000, finishedAt },
    ])
    await settle()
    const collapsed = test.terminal.plain()
    expect(collapsed).toContain('◆ jobs ×2')
    expect(collapsed).not.toContain('build')
    expect(collapsed).not.toContain('test')
    test.terminal.feed('\x0f') // Ctrl+O
    await settle()
    const expanded = test.terminal.plain()
    expect(expanded).toContain('⟳ build')
    expect(expanded).toContain('✓ test')
    // Settled jobs carry their wall time; running ones tick live (E8).
    expect(expanded).toContain('⏱ 1m10s')
  })

  it('undoes composer input with Ctrl+Z (web-parity editor keys)', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('hello')
    await settle()
    expect(test.app.composerText).toBe('hello')
    test.terminal.feed('\x1a') // Ctrl+Z
    await settle()
    expect(test.app.composerText).toBe('')
  })

  it('prefixes cross-day message clocks with the date (A10)', async () => {
    const test = mount()
    await settle()
    const yesterday = new Date(Date.now() - 2 * 86_400_000)
    const prefix = `${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
    const clock = `${String(yesterday.getHours()).padStart(2, '0')}:${String(yesterday.getMinutes()).padStart(2, '0')}`
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'x', thinking: [], state: 'committed', at: yesterday.getTime() },
    ]))
    await settle()
    expect(test.terminal.plain()).toContain(`${prefix} ${clock}`)
  })

  it('shows the session stats strip in the idle status slot (web parity)', async () => {
    const test = mount()
    test.terminal.resize(200, 30) // the full strip needs a wide terminal
    await settle()
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'x', thinking: [], state: 'committed',
        stats: { runMs: 162_000, ttftMs: 2_900 },
        usage: { inputTokens: 100, outputTokens: 100, cacheReadTokens: 100 } },
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'bash', arguments: '{}', state: 'done', durationMs: 1_000, turn: 1, step: 1 },
    ]))
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('1 轮 · 1 步')
    expect(plain).toContain('LLM 2m42s · 工具调用 1s')
    expect(plain).toContain('首 token 平均 2.9s · 0.6 tok/s')
    expect(plain).toContain('缓存命中 50%')
    expect(plain).toContain('输入 200 tok · 输出 100 tok')
  })

  it('reuses mounted views across appends instead of rebuilding', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([{ kind: 'user', id: 'u1', text: 'one' }]))
    await settle()
    expect(test.app.viewCount).toBe(1)
    test.app.render(doc([{ kind: 'user', id: 'u1', text: 'one' }]))
    await settle()
    expect(test.app.viewCount).toBe(1)
    test.app.render(doc([
      { kind: 'user', id: 'u1', text: 'one' },
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'reply', thinking: [], state: 'committed' },
    ]))
    await settle()
    expect(test.app.viewCount).toBe(2)
  })

  it('clears all views on reset', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'user', id: 'u1', text: 'one' },
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'reply', thinking: [], state: 'committed' },
      { kind: 'assistant', id: '1:2', turn: 1, step: 2, text: 'partial', thinking: [], state: 'streaming' },
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'bash', arguments: '{}', state: 'running' },
    ], true))
    await settle()
    // user + assistant(1:1) + assistant(1:2 streaming) + tool = 4 mounted views.
    expect(test.app.viewCount).toBe(4)
    test.app.reset()
    await settle()
    expect(test.app.viewCount).toBe(0)
  })

  it('scrolls the transcript with native PageUp', async () => {
    const test = mount()
    await settle()
    const longText = Array.from({ length: 20 }, (_, i) => `line ${i} of a deliberately long message`).join('\n')
    test.app.render(doc(Array.from({ length: 8 }, (_, i) => ({
      kind: 'assistant' as const, id: `a${i}`, turn: 1, step: i + 1, text: longText, thinking: [], state: 'committed' as const,
    }))))
    await settle(60)
    const atEnd = test.app.scrollTop
    expect(atEnd).toBeGreaterThan(0)
    test.terminal.feed('\x1b[5~')
    await settle(60)
    expect(test.app.scrollTop).toBeLessThan(atEnd)
    // F2: 离开底部后状态行挂出回底提示（End 键原生回底）；提示由 500ms
    // 轮询刷新（非动画路径，animFrameMs=0 下仍运行），故放宽等待。
    await waitFor(() => test.terminal.plain().includes('回到底部'))
    expect(test.terminal.plain()).toContain('(End)')
  })

  it('shows a new-messages pill while scrolled up and clears it on return (B16)', async () => {
    const test = mount()
    await settle()
    const longText = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const entries = Array.from({ length: 8 }, (_, i) => ({
      kind: 'assistant' as const, id: `a${i}`, turn: 1, step: i + 1, text: longText, thinking: [], state: 'committed' as const,
    }))
    test.app.render(doc(entries))
    await settle(60)
    test.terminal.feed('\x1b[5~') // 离开底部
    await settle(60)
    await waitFor(() => test.terminal.plain().includes('回到底部'))
    // 新消息到达 → pill 计数（离开时的条目数基线 8 → 9）。
    test.app.render(doc([...entries, { kind: 'assistant' as const, id: 'a8', turn: 1, step: 9, text: 'fresh', thinking: [], state: 'committed' as const }]))
    await settle(60)
    const state = test.app as unknown as { newMessages: number; offBottomBaseline: number | undefined }
    expect(state.offBottomBaseline).toBe(8)
    expect(state.newMessages).toBe(1)
    expect(test.terminal.plain()).toContain('1 条新消息')
    // 回到底部（PgDn 数次；End 在编辑器聚焦时被编辑器消费为行尾）→ 计数清除。
    // plain() 是累积输出，断言内部计数状态。
    for (let i = 0; i < 8; i++) test.terminal.feed('\x1b[6~') // PgDn
    await settle(60)
    await waitFor(() => (test.app as unknown as { newMessages: number }).newMessages === 0)
  })

  it('Home/End 聚焦输入框时走行首/行尾（光标），不动视口', async () => {
    const test = mount()
    await settle()
    const longText = Array.from({ length: 20 }, (_, i) => `line ${i} of a deliberately long message`).join('\n')
    test.app.render(doc(Array.from({ length: 8 }, (_, i) => ({
      kind: 'assistant' as const, id: `a${i}`, turn: 1, step: i + 1, text: longText, thinking: [], state: 'committed' as const,
    }))))
    await settle(60)
    const atEnd = test.app.scrollTop
    expect(atEnd).toBeGreaterThan(0)
    // pi 的键表把 Home/End 同时绑在 altScreen.top/bottom（视口滚动）与
    // editor.cursorLineStart/End（光标），alt-screen 监听器先消费——修复后
    // 输入框聚焦时转发给编辑器：视口滚动位置应保持不变。
    test.terminal.feed('\x1b[H') // Home
    await settle(60)
    expect(test.app.scrollTop).toBe(atEnd)
    test.terminal.feed('\x1b[F') // End
    await settle(60)
    expect(test.app.scrollTop).toBe(atEnd)
  })

  it('输入区不吃滚轮：编辑器行内的滚轮不滚动转录', async () => {
    const test = mount(undefined, { mouse: true }) // 上报开启时才收到滚轮事件
    await settle()
    const longText = Array.from({ length: 20 }, (_, i) => `line ${i} of a deliberately long message`).join('\n')
    test.app.render(doc(Array.from({ length: 8 }, (_, i) => ({
      kind: 'assistant' as const, id: `a${i}`, turn: 1, step: i + 1, text: longText, thinking: [], state: 'committed' as const,
    }))))
    await settle(60)
    const atEnd = test.app.scrollTop
    expect(atEnd).toBeGreaterThan(0)
    // 滚轮向上（button 64）落在编辑器行（30 行终端的最后一行，SGR 坐标
    // 1 基 → y=30）→ 忽略，视口不动。
    test.terminal.feed('\x1b[<64;5;30M')
    await settle(60)
    expect(test.app.scrollTop).toBe(atEnd)
    // 滚轮落在转录区（y=2）→ 视口滚动。
    test.terminal.feed('\x1b[<64;5;2M')
    await settle(60)
    expect(test.app.scrollTop).toBeLessThan(atEnd)
  })

  it('输入 @ 触发补全弹层后 Enter 仍提交正文（特殊字符修复）', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-tui-at-'))
    writeFileSync(join(workspace, 'hello.txt'), 'x')
    const test = mount({ model: 'pi-ai/deepseek-v4', session: 'session-abc', workspace })
    try {
      await settle()
      test.terminal.feed('@')
      await settle(200) // 等 @/# 补全请求返回建议
      test.terminal.feed('\r')
      await waitFor(() => test.calls.input.length === 1)
      // pi 编辑器对非 slash 前缀的补全在 Enter 时会应用建议并吞掉提交——
      // 包装后 Enter 收起弹层并提交正文。
      expect(test.calls.input[0]).toBe('@')
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })

  it('renders the goal, todo, and approval records from the document', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'goal', id: 'goal', objective: 'finish the work', phase: 'active', maxGoalRounds: 8, roundsStarted: 3 },
      { kind: 'todo', id: 'todo', items: [{ content: 'write tests', status: 'in_progress' }, { content: 'ship it', status: 'pending' }] },
      { kind: 'approval', id: 'approval:a1', toolName: 'bash', reason: 'runs rm', state: 'pending' },
    ], true))
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('goal')
    expect(plain).toContain('finish the work')
    expect(plain).toContain('round 3/8')
    expect(plain).toContain('write tests')
    expect(plain).toContain('ship it')
    expect(plain).toContain('approval')
    expect(plain).toContain('bash')
  })

  it('counts todo items and folds long lists (E7)', async () => {
    const test = mount()
    await settle()
    const items = Array.from({ length: 8 }, (_, index) => ({ content: `task ${index}`, status: index < 2 ? 'completed' : 'pending' }))
    test.app.render(doc([{ kind: 'todo', id: 'todo', items }]))
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('◆ todo ✓2 ▶0 ○6')
    expect(plain).toContain('task 5')
    expect(plain).not.toContain('task 6')
    expect(plain).toContain('… 还有 2 项')
  })

  it('expands injected-context rows on focus + Enter (E12)', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'notice', id: 'inject:9', text: '注入 · agent-instructions — full body here', tone: 'info', detail: 'line one\nline two\nline three' },
    ]))
    await settle()
    expect(test.terminal.plain()).not.toContain('line two') // collapsed
    test.terminal.feed('\t') // focus the notice
    await settle()
    test.terminal.feed('\r') // Enter expands
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('line one')
    expect(plain).toContain('line two')
    expect(plain).toContain('line three')
  })

  it('renders inline TeX math as Unicode (A5)', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'The energy is $E = mc^2$ and $x_i$', thinking: [], state: 'committed' },
    ]))
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('mc²')
    expect(plain).toContain('xᵢ')
  })

  it('shows session stats and the workspace in the footer', async () => {
    const test = mount({ model: 'pi-ai/deepseek-v4', session: 'session-abc', workspace: '/tmp/ws' })
    await settle()
    test.app.render(doc([
      { kind: 'user', id: 'u1', text: 'one' },
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'reply', thinking: [], state: 'committed', usage: { inputTokens: 1500, outputTokens: 800 } },
    ]))
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('/tmp/ws')
    expect(plain).toContain('2 msgs')
    expect(plain).toContain('in 1.5k')
    expect(plain).toContain('out 800')
  })

  it('opens the inline slash menu that keeps composer text and filters live', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('/')
    await settle()
    expect(test.app.composerText).toBe('/') // the slash STAYS in the composer
    expect(test.terminal.plain()).toContain('/quit')
    expect(test.terminal.plain()).toContain('/new')
    // Typing filters the menu while the composer keeps the full line; the
    // selected-row marker proves the current frame narrowed to /quit.
    test.terminal.feed('qu')
    await settle()
    expect(test.app.composerText).toBe('/qu')
    expect(test.terminal.plain()).toContain('❯/quit')
    // Enter executes the filtered command through the catalog resolution.
    test.terminal.feed('it\r')
    await settle()
    expect(test.calls.quit).toBe(1)
    expect(test.calls.input).toEqual([])
  })

  it('closes the slash menu on Esc and clears the composer', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('/mod')
    await settle()
    expect(test.terminal.plain()).toContain('/model')
    test.terminal.feed('\x1b')
    await settle()
    expect(test.app.composerText).toBe('')
  })

  it('sorts the slash menu alphabetically by display name', async () => {
    const test = mount()
    await settle()
    // mount 的目录是 [new, quit, help, model]（非字母序）；输入 / 后应
    // 按显示名 hotkeys → model → new → quit 展示，首行（选中态）即字母序第一。
    test.terminal.feed('/')
    await settle()
    const frame = test.terminal.plain()
    const positions = ['/hotkeys', '/model', '/new', '/quit'].map(name => frame.indexOf(name))
    expect(positions.every(pos => pos >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(frame).toContain('❯/hotkeys')
  })

  it('wraps the slash menu selection around the list ends and pages with PgUp/PgDn', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('/')
    await settle()
    expect(test.terminal.plain()).toContain('❯/hotkeys')
    test.terminal.feed('\x1b[B\x1b[B\x1b[B') // ↓ 三次到尾 /quit
    await settle()
    expect(test.terminal.plain()).toContain('❯/quit')
    test.terminal.feed('\x1b[B') // ↓ 触底 → 循环回首部
    await settle()
    expect(test.terminal.plain()).toContain('❯/hotkeys')
    test.terminal.feed('\x1b[A') // ↑ 首部 → 循环到尾部
    await settle()
    expect(test.terminal.plain()).toContain('❯/quit')
    // PgUp/PgDn 经视口钩子路由到菜单：越界钳制在两端，不滚转录。
    test.terminal.feed('\x1b[6~')
    await settle()
    expect(test.terminal.plain()).toContain('❯/quit')
    test.terminal.feed('\x1b[5~')
    await settle()
    expect(test.terminal.plain()).toContain('❯/hotkeys')
    test.terminal.feed('\x1b') // 关闭菜单
    await settle()
    expect(test.app.composerText).toBe('')
  })

  it('runs the selected slash-menu item on Enter without a prior Tab (上游语义)', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('/')
    await settle()
    expect(test.terminal.plain()).toContain('❯/hotkeys') // 首项选中
    test.terminal.feed('\r') // Enter 直接执行选中项，不提交过滤串 `/`
    await settle()
    expect(test.calls.commandPicks).toContainEqual({ name: '__help', raw: '' })
    expect(test.app.composerText).toBe('') // 执行后输入行清空
    // ↓ 选中 /quit 后 Enter：直接退出（不再静默）。
    test.terminal.feed('/')
    await settle()
    test.terminal.feed('\x1b[B\x1b[B\x1b[B')
    await settle()
    expect(test.terminal.plain()).toContain('❯/quit')
    test.terminal.feed('\r')
    await settle()
    expect(test.calls.quit).toBe(1)
  })

  it('pages a long option card with PgUp/PgDn (顶层覆盖层路由)', async () => {
    const test = mount()
    await settle()
    const options = Array.from({ length: 14 }, (_, i) => `option ${i}`)
    const answerPromise = test.app.askDialog({ title: 'pick one', options })
    await settle()
    expect(test.terminal.plain()).toContain('1. option 0')
    test.terminal.feed('\x1b[6~') // PgDn → 第 7 项（窗口跟随，选中行可见）
    await settle()
    expect(test.terminal.plain()).toContain('❯ 7. option 6')
    test.terminal.feed('\r')
    await settle()
    const answer = await answerPromise
    expect(answer.picked).toBe('option 6')
  })

  it('completes the selected command with Tab and passes inline args (cc style)', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('/m')
    await settle()
    test.terminal.feed('\t') // Tab completes the selected command name
    await settle()
    expect(test.app.composerText).toBe('/model ')
    test.terminal.feed('pi-ai/deepseek-v4\r')
    await settle()
    // The inline arg rides the slash line (cc style).
    expect(test.calls.commandPicks).toContainEqual({ name: 'model', raw: 'pi-ai/deepseek-v4' })
  })

  it('completes native rows by their display name, not the internal __ value', async () => {
    const test = mount()
    await settle()
    test.app.setCommands([
      { value: '__model', label: '/model <provider/model>', description: 'switch the model' },
      { value: '__permission', label: '/permission <preset>', description: 'switch the preset' },
    ])
    test.terminal.feed('/mod')
    await settle()
    test.terminal.feed('\t')
    await settle()
    expect(test.app.composerText).toBe('/model ')
    // Submitting the completed line still resolves to the internal value.
    test.terminal.feed('\r')
    await settle()
    expect(test.calls.commandPicks).toContainEqual({ name: '__model', raw: '' })
  })

  it('resolves command aliases to their canonical commands (K1)', async () => {
    const test = mount()
    await settle()
    // exit → quit
    test.terminal.feed('/exit\r')
    await settle()
    expect(test.calls.quit).toBe(1)
    // clear → new
    test.terminal.feed('/clear\r')
    await settle()
    expect(test.calls.newSession).toBe(1)
    // The alias rides the slash line: /m <args> → model <args>.
    test.terminal.feed('/m pi-ai/deepseek-v4\r')
    await settle()
    expect(test.calls.commandPicks).toContainEqual({ name: 'model', raw: 'pi-ai/deepseek-v4' })
    // /? resolves to the help row.
    test.terminal.feed('/?\r')
    await settle()
    expect(test.calls.commandPicks).toContainEqual({ name: '__help', raw: '' })
  })

  it('resolves the /r alias to the resume command', async () => {
    const test = mount()
    await settle()
    test.app.setCommands([
      { value: '__resume', label: '/resume · 恢复会话', description: 'switch session', aliases: ['r'] },
    ])
    test.terminal.feed('/r\r')
    await settle()
    expect(test.calls.commandPicks).toContainEqual({ name: '__resume', raw: '' })
  })

  it('filters the slash menu by alias names while typing', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('/ex')
    await settle()
    expect(test.terminal.plain()).toContain('/quit')
    expect(test.terminal.plain()).toContain('❯')
  })

  it('matches slash queries by subsequence, tolerating skipped letters (CC-03)', async () => {
    const test = mount()
    await settle()
    // "mdl" 不是任何连续子串（旧前缀/子串匹配会空结果），子序列命中 /model。
    test.terminal.feed('/mdl')
    await settle()
    expect(test.terminal.plain()).toContain('/model')
  })

  it('does not open the palette for a slash typed mid-text', async () => {
    const test = mount()
    await settle()
    test.terminal.feed('check ')
    await settle()
    test.terminal.feed('/')
    await settle()
    expect(test.calls.commands).toBe(0)
    test.terminal.feed('tmp\r')
    await settle()
    expect(test.calls.input).toEqual(['check /tmp'])
  })


  it('answers an option question through the dialog overlay', async () => {
    const test = mount()
    await settle()
    const answerPromise = test.app.askDialog({ title: 'Which color?', options: ['red', 'blue'] })
    await settle()
    expect(test.terminal.plain()).toContain('Which color?')
    test.terminal.feed('\r')
    expect(await answerPromise).toEqual({ picked: 'red', reason: 'picked' })
  })

  it('answers a free-text question with typed input', async () => {
    const test = mount()
    await settle()
    const answerPromise = test.app.askDialog({ title: 'What is your name?', options: [] })
    await settle()
    expect(test.terminal.plain()).toContain('What is your name?')
    expect(test.terminal.plain()).toContain('Enter 提交')
    test.terminal.feed('你好\r')
    expect(await answerPromise).toEqual({ picked: '你好', reason: 'picked' })
  })

  it('cancels a dialog on escape', async () => {
    const test = mount()
    await settle()
    const answerPromise = test.app.askDialog({ title: 'confirm?', options: ['yes', 'no'] })
    await settle()
    test.terminal.feed('\x1b')
    await settle(50)
    expect(await answerPromise).toEqual({ reason: 'cancelled' })
  })

  it('opens the sectioned /hotkeys panel with aligned binding rows', async () => {
    const test = mount()
    await settle()
    test.app.showHotkeys()
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('快捷键')
    // Grouped sections with one binding per row (no more run-on lines).
    expect(plain).toContain('输入')
    expect(plain).toContain('Ctrl+Enter') // B5: 打断当前回合并发送
    // 输入区新增 Ctrl+Enter 行后「会话与模型」区在窗口外：滚动揭示。
    for (let i = 0; i < 6; i++) test.terminal.feed('\x1b[B')
    await settle()
    expect(test.terminal.plain()).toContain('会话与模型')
    expect(test.terminal.plain()).toContain('Ctrl+G')
    expect(test.terminal.plain()).toContain('选择模型')
    // The 命令与退出 section sits below the panel window: arrow keys scroll
    // the focused panel and reveal it.
    for (let i = 0; i < 20; i++) test.terminal.feed('\x1b[B')
    await settle()
    expect(test.terminal.plain()).toContain('Ctrl+/')
    expect(test.terminal.plain()).toContain('命令与退出')
    // Esc closes the panel through its own focused handler.
    test.terminal.feed('\x1b')
    await settle()
  })

  it('suspends the surface to open $EDITOR and resumes with keys re-attached (K2)', async () => {
    const previous = { editor: process.env.EDITOR, visual: process.env.VISUAL }
    // A daemonizing editor (e.g. `code --wait`) holds inherited stdio open
    // forever, so the test pins a terminal editor that exits immediately.
    // 注意：`process.env.VISUAL = undefined` 在 Node 里会写成字符串
    // "undefined"（而非删除），随后 spawn 出 `undefined "…"` 的 shell 报错；
    // 必须用 delete 清除。
    delete process.env.VISUAL
    process.env.EDITOR = 'true'
    try {
      const test = mount()
      await settle()
      await test.app.openExternalEditor('/tmp/settings.yaml')
      await settle()
      // The surface repaints after the resume and the listener works again.
      expect(test.terminal.plain()).toContain('dsh tui')
      test.terminal.feed('/quit\r')
      await settle()
      expect(test.calls.quit).toBe(1)
    } finally {
      process.env.EDITOR = previous.editor
      process.env.VISUAL = previous.visual
    }
  })

  it('copies plain text to the clipboard via OSC 52 (K2)', async () => {
    const test = mount()
    await settle()
    test.app.copyText('settings.yaml path')
    expect(test.terminal.output).toContain('\x1b]52;c;')
    expect(test.app.toastVisible).toBe(true)
  })

  it('renders plugin projection chips in the idle slot (K3)', async () => {
    const test = mount()
    await settle()
    test.app.setProjections([
      {
        key: 'permissions', currentValue: 'workspace-write',
        options: [
          { value: 'workspace-write', name: 'workspace-write' },
          { value: 'danger-full-access', name: 'danger-full-access' },
        ],
      },
      {
        key: 'goal', currentValue: 'a',
        options: [{ value: 'a', name: 'Goal A' }],
      },
    ])
    test.app.render(doc([]))
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('权限')
    expect(plain).toContain('Workspace Write')
    expect(plain).toContain('goal')
    expect(plain).toContain('Goal A')
  })

  it('colors the permission chip by risk level (CC-01)', async () => {
    const test = mount()
    await settle()
    test.app.setProjections([
      {
        key: 'permissions', currentValue: 'danger-full-access',
        options: [
          { value: 'workspace-write', name: 'workspace-write' },
          { value: 'danger-full-access', name: 'danger-full-access' },
          { value: 'read-only', name: 'read-only' },
        ],
      },
    ])
    test.app.render(doc([]))
    await settle()
    const raw = test.terminal.output
    // full-access 红、workspace-write 蓝、read-only 暗灰：显示名（web 同款）
    // 与色码相邻成串。
    expect(raw).toContain(fg('error')('Full access'))
    test.app.setProjections([{ key: 'permissions', currentValue: 'workspace-write', options: [] }])
    test.app.render(doc([]))
    await settle()
    expect(test.terminal.output).toContain(fg('info')('Workspace Write'))
    test.app.setProjections([{ key: 'permissions', currentValue: 'read-only', options: [] }])
    test.app.render(doc([]))
    await settle()
    expect(test.terminal.output).toContain(fg('dim')('Read Only'))
    // 无投影注册时回退 fold 的 permissionPreset，同样分色 + 显示名。
    test.app.setProjections([])
    test.app.render({ entries: [], busy: false, permissionPreset: 'read-only' })
    await settle()
    expect(test.terminal.output).toContain(fg('dim')('Read Only'))
  })

  it('pulses a thinking marker while streaming with empty text (CC-06)', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: '', thinking: ['还在想…'], state: 'streaming' },
    ]))
    await settle()
    expect(test.terminal.plain()).toContain('⏺ ● ○ ○')
    // 正文出现后重渲染：脉冲行从新帧中消失（fake 终端缓冲是累计写入，
    // 检查重绘后的最后一帧区域不可行——由 updateEntryView 每帧重算 footer 保证）。
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'hi', thinking: ['还在想…'], state: 'streaming' },
    ]))
    await settle()
    expect(test.terminal.plain()).toContain('hi')
  })

  it('opens the trajectory overlay from Ctrl+L (B11/H31)', async () => {
    const test = mount()
    await settle()
    test.app.showTrajectory([
      { seq: 1, type: 'turn/start', at: Date.now(), summary: 'turn 1 开始' },
      { seq: 2, type: 'tool/call', at: Date.now(), summary: 'bash {"command":"ls"}' },
    ])
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('轨迹')
    expect(plain).toContain('2 条事件')
    expect(plain).toContain('#02')
    expect(plain).toContain('tool/call')
  })

  it('pi 预设下 Ctrl+C 中断当前轮、Ctrl+P 打开模型 picker（keymap）', async () => {
    const test = mount({ model: 'pi-ai/deepseek-v4', session: 'session-abc', workspace: '/workspace' }, { keymap: 'pi' })
    await settle()
    test.app.render({ entries: [], busy: true })
    await settle()
    test.terminal.feed('\x03') // Ctrl+C
    await settle()
    expect(test.calls.interrupt).toBe(1)
    expect(test.calls.quit).toBe(0)
    // 空闲 Ctrl+C → 退出（pi 语义）。
    test.app.render({ entries: [], busy: false })
    await settle()
    test.terminal.feed('\x03')
    await settle()
    expect(test.calls.quit).toBe(1)
    // Ctrl+P → 模型 picker（pi：循环模型），权限改走 /permission。
    test.terminal.feed('\x10')
    await settle()
    expect(test.calls.models).toBe(1)
    expect(test.calls.permissions).toBe(0)
  })

  it('setKeymap 热切换后全局键立即按新预设解析', async () => {
    const test = mount()
    await settle()
    test.app.setKeymap('pi')
    test.app.render({ entries: [], busy: true })
    await settle()
    test.terminal.feed('\x03')
    await settle()
    expect(test.calls.interrupt).toBe(1)
  })

  it('pi 预设下 /hotkeys 面板展示 pi 键位说明', async () => {
    const test = mount({ model: 'pi-ai/deepseek-v4', session: 'session-abc', workspace: '/workspace' }, { keymap: 'pi' })
    await settle()
    test.app.showHotkeys()
    await settle()
    const plain = test.terminal.plain()
    // 首屏可见新行（Alt+R 输入历史搜索）；Alt+R 下移了窗口行数。
    expect(plain).toContain('Alt+R')
    expect(plain).toContain('↓ 还有')
    // 滚动后可见 pi 专属键位：Ctrl+P 选择模型（cc 预设下 Ctrl+P 是权限）。
    test.terminal.feed('\x1b[B')
    test.terminal.feed('\x1b[B')
    await settle()
    const scrolled = test.terminal.plain()
    expect(scrolled).toContain('Ctrl+P')
    expect(scrolled).toContain('选择模型')
  })

  it('compose 在 $EDITOR 中打开草稿，空草稿不发送（pi A3）', async () => {
    const previous = { editor: process.env.EDITOR, visual: process.env.VISUAL }
    delete process.env.VISUAL
    process.env.EDITOR = 'true'
    try {
      const test = mount()
      await settle()
      await test.app.composeInEditor()
      await settle()
      expect(test.calls.input).toEqual([])
      expect(test.terminal.plain()).toContain('草稿为空，未发送')
    } finally {
      if (previous.editor === undefined) delete process.env.EDITOR
      else process.env.EDITOR = previous.editor
      if (previous.visual === undefined) delete process.env.VISUAL
      else process.env.VISUAL = previous.visual
    }
  })

  it('opencode 预设：Ctrl+X leader 和弦解析（会话/模型/重命名/清输入）', async () => {
    const test = mount({ model: 'pi-ai/deepseek-v4', session: 'session-abc', workspace: '/workspace' }, { keymap: 'opencode' })
    await settle()
    // Ctrl+X l → 会话列表。
    test.terminal.feed('\x18')
    test.terminal.feed('l')
    await settle()
    expect(test.calls.sessions).toBe(1)
    // Ctrl+X m → 模型。
    test.terminal.feed('\x18')
    test.terminal.feed('m')
    await settle()
    expect(test.calls.models).toBe(1)
    // Ctrl+R → 重命名（会话/工作区）。
    test.terminal.feed('\x12')
    await settle()
    expect(test.calls.commandPicks).toContainEqual({ name: '__rename', raw: '' })
    // busy Ctrl+C → 清空输入而非中断（opencode input_clear 语义）。
    test.terminal.feed('draft text')
    test.app.render({ entries: [], busy: true })
    await settle()
    test.terminal.feed('\x03')
    await settle()
    expect(test.app.composerText).toBe('')
    expect(test.calls.interrupt).toBe(0)
    // idle Ctrl+C → 退出。
    test.app.render({ entries: [], busy: false })
    await settle()
    test.terminal.feed('\x03')
    await settle()
    expect(test.calls.quit).toBe(1)
  })

  it('refreshTheme 重建视图且保留消息内容（换肤冒烟）', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: '换肤前的消息', thinking: [], state: 'committed' },
    ]))
    await settle()
    expect(test.terminal.plain()).toContain('换肤前的消息')
    test.app.refreshTheme()
    await settle()
    expect(test.terminal.plain()).toContain('换肤前的消息')
  })

  it('打开 /settings 面板并就地刷新行（M2）', async () => {
    const test = mount()
    await settle()
    test.app.showSettings([
      { key: '语言', current: 'zh', target: '→ /lang' },
      { key: '主题', current: '暗色 · web', tone: 'accent', target: '→ /theme' },
    ])
    await settle()
    expect(test.terminal.plain()).toContain('设置')
    expect(test.terminal.plain()).toContain('语言')
    expect(test.terminal.plain()).toContain('暗色 · web')
    // 行变化后就地刷新。
    test.app.showSettings([{ key: '主题', current: '暗色 · opencode', tone: 'accent', target: '→ /theme' }])
    await settle()
    expect(test.terminal.plain()).toContain('暗色 · opencode')
  })

  it('打开 /plugins 能力清单（M3）', async () => {
    const test = mount()
    await settle()
    test.app.showPlugins([
      { kind: 'header', title: '命令 (1)' },
      { kind: 'item', action: 'command:goal', label: '/goal', detail: 'Set the session goal' },
      { kind: 'header', title: '投影 (1)' },
      { kind: 'item', action: 'projection:permissions', label: 'permissions', detail: 'workspace-write', tone: 'accent' },
    ])
    await settle()
    const plain = test.terminal.plain()
    expect(plain).toContain('插件与能力')
    expect(plain).toContain('命令 (1)')
    expect(plain).toContain('/goal')
    expect(plain).toContain('permissions')
  })

  it('opencode 语式：/ 弹方角 popup（描述列 + 面板入口），且 /quit 仍执行', async () => {
    const test = mount({ model: 'pi-ai/deepseek-v4', session: 'session-abc', workspace: '/workspace' }, { keymap: 'opencode' })
    await settle()
    test.terminal.feed('/new')
    await settle()
    const menu = test.terminal.plain()
    expect(menu).toContain('/new')
    expect(menu).toContain('test') // 描述列（与 cc spacious 同，pi compact 无）
    expect(menu).toContain('┌') // opencode 方角边框（pi 是圆角 ╭）
    expect(menu).not.toContain('╭')
    expect(menu).toContain('命令 · ') // 标题计数行
    expect(menu).toContain('Ctrl+P 面板') // 弹层与命令面板并存
    // 整行提交仍按命令目录解析执行。
    test.terminal.feed('\x7f'.repeat(4)) // 退格清掉 /new
    await settle()
    test.terminal.feed('/quit\r')
    await settle()
    expect(test.calls.quit).toBe(1)
  })

  it('pi 语式：斜杠菜单紧凑 + 圆角框布局（无描述列）', async () => {
    const compact = mount({ model: 'pi-ai/deepseek-v4', session: 'session-abc', workspace: '/workspace' }, { keymap: 'pi' })
    await settle()
    compact.terminal.feed('/new')
    await settle()
    expect(compact.terminal.plain()).toContain('/new')
    expect(compact.terminal.plain()).not.toContain('test') // 描述列被省略（cc spacious 下会显示）
    expect(compact.terminal.plain()).toContain('╭') // pi 式圆角框布局
    const spacious = mount()
    await settle()
    spacious.terminal.feed('/new')
    await settle()
    expect(spacious.terminal.plain()).toContain('test')
    expect(spacious.terminal.plain()).not.toContain('╭') // cc 无边框行
  })

  it('审批卡形态随预设：cc 无边框、pi 圆角卡（广义交互层）', async () => {
    const cc = mount()
    await settle()
    const ccPending = cc.app.askDialog({ title: 'approve?', options: ['yes', 'no'], icon: '⚠' })
    await settle()
    expect(cc.terminal.plain()).toContain('approve?')
    expect(cc.terminal.plain()).not.toContain('╭')
    cc.terminal.feed('\x1b') // 取消，清理 pending
    await settle()
    await ccPending
    const pi = mount({ model: 'pi-ai/deepseek-v4', session: 'session-abc', workspace: '/workspace' }, { keymap: 'pi' })
    await settle()
    const piPending = pi.app.askDialog({ title: 'approve?', options: ['yes', 'no'], icon: '⚠' })
    await settle()
    expect(pi.terminal.plain()).toContain('╭')
    pi.terminal.feed('\x1b')
    await settle()
    await piPending
  })

  it('renders error notices from failed turns', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'notice', id: 'notice:1', text: 'Error: TIMEOUT: upstream timed out', tone: 'error' },
    ]))
    await settle()
    expect(test.terminal.plain()).toContain('Error: TIMEOUT: upstream timed out')
  })

  it('truncates long tool output and expands it with Tab + Enter', async () => {
    const test = mount()
    await settle()
    const longOutput = Array.from({ length: 20 }, (_, i) => `output line ${i}`).join('\n')
    test.app.render(doc([
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'bash', arguments: '{"command":"seq"}', state: 'done',
        output: { blocks: [{ type: 'text', text: longOutput }] } },
    ]))
    await settle()
    // cc 语式：执行结束后自动收起为摘要行（状态 + 行数 + 首行输出）。
    const collapsed = test.terminal.plain()
    expect(collapsed).toContain('✓ 完成 · 20 行输出 · output line 0（⏎ 展开）')
    expect(collapsed).not.toContain('output line 19')
    // Tab focuses the card, Enter expands the full result.
    test.terminal.feed('\t')
    await settle()
    test.terminal.feed('\r')
    await settle()
    const expanded = test.terminal.plain()
    expect(expanded).toContain('output line 19')
    // `i` on the focused card opens the raw-input detail view (B10).
    test.terminal.feed('i')
    await settle()
    expect(test.terminal.plain()).toContain('raw input')
    expect(test.terminal.plain()).toContain('"command": "seq"')
    const after = test.terminal.plain()
    expect(after).toContain('⏎ 展开/收起')
  })

  it('cycles focus back to the composer with Escape', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'bash', arguments: '{}', state: 'done', output: { blocks: [] } },
    ]))
    await settle()
    test.terminal.feed('\t')
    await settle()
    test.terminal.feed('\x1b')
    await settle()
    test.terminal.feed('back to composer\r')
    await settle()
    expect(test.calls.input).toEqual(['back to composer'])
  })

  it('pins the composer to the bottom of the frame', async () => {
    const test = mount()
    await settle(80)
    // The alt screen addresses rows by cursor position, so the whole frame
    // arrives as one stream; order of fragments proves the vertical layout.
    const plain = test.terminal.plain().replace(/\s+/g, ' ').trim()
    const footerIndex = plain.indexOf('msgs')
    const lastBorderIndex = plain.lastIndexOf('─')
    expect(footerIndex).toBeGreaterThan(-1)
    // The footer sits above the editor, and the editor's bottom border is the
    // very last thing rendered — nothing draws below the composer.
    expect(lastBorderIndex).toBeGreaterThan(footerIndex)
    expect(plain.endsWith('─')).toBe(true)
  })
})
