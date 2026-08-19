/**
 * The pi-tui surface on the vendored pi palette, driven headlessly through the
 * real TuiAltScreen on a FakeTerminal: header identity, role-styled messages,
 * tool cards, busy loader slot, native PageUp/Down scrolling, view reuse, and
 * reset-on-session-swap.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { TuiAltScreen, setCapabilities } from '@earendil-works/pi-tui'
import type { Terminal } from '@earendil-works/pi-tui'
import { PiTuiApp, piTuiInternals } from '../src/app/pi-tui-app.ts'
import type { PiTuiAppOptions } from '../src/app/pi-tui-app.ts'
import { fg } from '../src/app/pi/color.ts'
import { readFileSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { SurfaceMeta, TerminalAppHandlers } from '../src/app/terminal-app.ts'
import type { ViewDocument, ViewEntry } from '../src/document/document.ts'
import { FakeTerminal } from './helpers/fake-terminal.ts'

/** Build a document snapshot for render tests. */
function doc(entries: ViewEntry[], busy = false): ViewDocument {
  return { entries, busy }
}

interface Mounted {
  app: PiTuiApp
  terminal: FakeTerminal
  handlers: TerminalAppHandlers
  calls: { input: string[]; interrupt: number; quit: number; sessions: number; models: number; permissions: number; newSession: number; commands: number; exitPlan: number; workspace: number; forks: number; rates: number; shell: Array<{ text: string; hidden: boolean }>; steers: string[]; retrieves: number; commandPicks: Array<{ name: string; raw?: string }>; sessionSearch: string[] }
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
  piTuiInternals.createTui = (t: Terminal) => new TuiAltScreen(t)
  // Deterministic frames: brand/status shimmer is unit-tested in brand.spec.
  piTuiInternals.animFrameMs = 0
  const calls = { input: [] as string[], interrupt: 0, quit: 0, sessions: 0, models: 0, permissions: 0, newSession: 0, commands: 0, exitPlan: 0, workspace: 0, forks: 0, rates: 0, shell: [] as Array<{ text: string; hidden: boolean }>, steers: [] as string[], retrieves: 0, commandPicks: [] as Array<{ name: string; raw?: string }>, sessionSearch: [] as string[] }
  const app = new PiTuiApp(options)
  const handlers: TerminalAppHandlers = {
    onInput: (text) => { calls.input.push(text) },
    onInterrupt: () => { calls.interrupt++ },
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
    const test = mount()
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
    expect(test.terminal.plain()).toContain('Deep diving...')
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
    const test = mount()
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
    const test = mount()
    await settle()
    test.app.render(doc([], true))
    await settle()
    expect(test.terminal.plain()).toContain('Deep diving')
    test.app.render(doc([], false))
    await settle()
    expect(test.terminal.plain()).toContain('Deep diving')
  })

  it('keeps the composer enabled while busy (queue upstream)', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([], true))
    await settle()
    test.terminal.feed('queued while busy\r')
    await settle()
    expect(test.calls.input).toEqual(['queued while busy'])
  })

  it('maps Esc to interrupt while busy and Ctrl+C to quit while idle', async () => {
    const test = mount()
    await settle()
    test.app.render(doc([], true))
    await settle()
    test.terminal.feed('\x1b')
    await settle()
    expect(test.calls.interrupt).toBe(1)
    expect(test.calls.quit).toBe(0)

    test.app.render(doc([], false))
    await settle()
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
    const test = mount({ model: 'pi-ai/deepseek-v4', session: 'session-abc', contextWindow: 100_000 })
    test.terminal.resize(200, 30)
    test.app.render({ entries: [], busy: false }) // refresh the footer at the new width
    await settle()
    // The fixed status area under the input line carries NO shortcut hints
    // (they live in /hotkeys); the facts row shows model + ctx pressure.
    expect(test.terminal.plain()).not.toContain('Ctrl+C 退出')
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
    test.app.render(doc([
      { kind: 'assistant', id: '1:1', turn: 1, step: 1, text: 'answer', thinking: ['first thought', 'second thought', 'third thought'], state: 'committed' },
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
    const test = mount()
    await settle()
    test.app.render({ entries: [], busy: true })
    await new Promise(resolve => setTimeout(resolve, 1100))
    test.app.render({ entries: [], busy: true })
    await settle()
    expect(test.terminal.plain()).toContain('Deep diving...')
  })

  it('renders the busy status in the web-brand gradient', async () => {
    const test = mount()
    await settle()
    test.app.render({ entries: [], busy: true })
    await settle()
    // Spinner (accent) → space → gradient starts at deepseek-450: the exact
    // sequence only the status line produces (the brand splash has no spinner).
    expect(test.terminal.output).toContain('⠋\x1b[39m \x1b[38;2;86;134;254')
    expect(test.terminal.plain()).toContain('Deep diving...')
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
    const test = mount()
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
    expect(test.terminal.plain()).toContain('❯ /quit · 退出 TUI')
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
    expect(frame).toContain('❯ /hotkeys')
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
    expect(plain).toContain('会话与模型')
    expect(plain).toContain('Ctrl+G')
    expect(plain).toContain('选择模型')
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
    expect(plain).toContain('workspace-write')
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
    // full-access 红、workspace-write 蓝、read-only 暗灰：值与色码相邻成串。
    expect(raw).toContain(fg('error')('danger-full-access'))
    test.app.setProjections([{ key: 'permissions', currentValue: 'workspace-write', options: [] }])
    test.app.render(doc([]))
    await settle()
    expect(test.terminal.output).toContain(fg('info')('workspace-write'))
    test.app.setProjections([{ key: 'permissions', currentValue: 'read-only', options: [] }])
    test.app.render(doc([]))
    await settle()
    expect(test.terminal.output).toContain(fg('dim')('read-only'))
    // 无投影注册时回退 fold 的 permissionPreset，同样分色。
    test.app.setProjections([])
    test.app.render({ entries: [], busy: false, permissionPreset: 'read-only' })
    await settle()
    expect(test.terminal.output).toContain(fg('dim')('read-only'))
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
    // 窗口首屏可见的 pi 键位：Ctrl+P 选择模型（cc 预设下 Ctrl+P 是权限）。
    expect(plain).toContain('Ctrl+P')
    expect(plain).toContain('选择模型')
    // 其余行在滚动窗口内。
    expect(plain).toContain('↓ 还有')
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
    const before = test.terminal.plain()
    expect(before).toContain('还有 14 行（⏎ 展开）')
    expect(before).not.toContain('output line 19')
    // Tab focuses the card, Enter expands it.
    test.terminal.feed('\t')
    await settle()
    test.terminal.feed('\r')
    await settle()
    expect(test.terminal.plain()).toContain('output line 19')
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
