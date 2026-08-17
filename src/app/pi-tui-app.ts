/**
 * The pi-tui surface on pi's own interactive-mode composition (vendored
 * components, MIT): TuiAltScreen with a layout-root VStack whose transcript
 * ScrollView grows, so the composer stays pinned to the bottom. Document
 * entries map 1:1 onto vendored pi components — user/assistant messages,
 * tool executions (output + word-level diffs), retry/compaction status — and
 * are reconciled incrementally by entry identity.
 * @module dsh-tui-app/app/pi-tui-app
 */

import {
  CombinedAutocompleteProvider,
  Container,
  Editor,
  Loader,
  ProcessTerminal,
  ScrollView,
  SelectList,
  Text,
  truncateToWidth,
  TuiAltScreen,
  VStack,
  getKeybindings,
  isViewportTUI,
  matchesKey,
  type Component,
  type TUI,
  type Terminal,
} from '@earendil-works/pi-tui'
import { emptyDocument } from '../document/document.ts'
import type { TurnOutcome, ViewDocument, ViewEntry } from '../document/document.ts'
import { statsStrip } from '../projection/stats.ts'
import { BrandView, shouldShowBrand, BRAND, ICE, gradientText } from '../view/brand.ts'
import type { CommandChoice, ModelChoice, PermissionChoice, ProjectionRow, SessionChoice, SurfaceMeta, TerminalApp, TerminalAppHandlers } from './terminal-app.ts'
import { FilterablePickerPanel } from '../view/components/filterable-picker.ts'
import type { PickerRow } from '../view/components/filterable-picker.ts'
import { synthesizeAssistantMessage, synthesizeToolResult } from '../projection/synthesis/pi-messages.ts'
import { AssistantMessageComponent } from '../view/pi-vendor/assistant-message.ts'
import { UserMessageComponent } from '../view/pi-vendor/user-message.ts'
import { ToolExecutionComponent } from '../view/pi-vendor/tool-execution.ts'
import { RetryStatusIndicator } from '../view/pi-vendor/status-indicator.ts'
import { CompactionSummaryMessageComponent } from '../view/pi-vendor/compaction-summary-message.ts'
import { DynamicBorder } from '../view/pi-vendor/dynamic-border.ts'
import { resolveToolDefinition, toolArgs } from '../view/pi-vendor/dsh-tools.ts'
import { codeLabelTransformer } from '../view/pi-vendor/markdown-transform.ts'
import { mermaidTransformer } from '../view/pi-vendor/mermaid-transformer.ts'
import { getEditorTheme, getMarkdownTheme, getSelectListTheme } from '../view/pi-vendor/../theme/theme.ts'
import { CapabilityPanel } from '../view/components/panels.ts'
import type { JobRow } from '../view/components/panels.ts'
import { FooterLine } from '../view/components/footer.ts'
import { ExpandableNoticeView, NoticeEntryView, convergeNotices } from '../view/components/notice-view.ts'
import { fileLink } from '../view/components/file-link.ts'
import { FocusableToolCard } from '../view/components/tool-card.ts'
import { FocusableRetryRow } from '../view/components/retry-row.ts'
import { CollapsibleMessage, maybeCollapse } from '../view/components/collapsible-message.ts'
import { FocusableFrame } from '../view/components/focus-frame.ts'
import { SlashMenu } from '../view/components/slash-menu.ts'
import type { SlashMenuItem } from '../view/components/slash-menu.ts'
import { HotkeysPanel } from '../view/components/hotkeys-panel.ts'
import type { OverlayHandle } from '@earendil-works/pi-tui'
import { ApprovalEntryView, presentApprovalDialog } from '../view/components/approval-view.ts'
import type { ApprovalAnswer, ApprovalQuestion } from '../view/components/approval-view.ts'
import { fg, bold, italic } from './pi/color.ts'
import { strings } from '../view/strings.ts'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import spawn from 'cross-spawn'

/** A fixed-height blank block: bottom-anchors short transcripts (T7). */
class BottomPad implements Component {
  height = 0

  setHeight(height: number): void {
    this.height = height
  }

  invalidate(): void {
    // Stateless.
  }

  render(_width: number): string[] {
    return new Array<string>(Math.max(0, this.height)).fill('')
  }
}

/** Two blank lines while idle — pi's IdleStatus keeps the working slot's height stable. */
class IdleStatus implements Component {
  invalidate(): void {
    // No cached state to invalidate.
  }

  render(width: number): string[] {
    const emptyLine = ' '.repeat(Math.max(0, width))
    return [emptyLine, emptyLine]
  }
}

/** Working-status slot: animated loader while busy, transient toast or two
 *  blank lines while idle. */
class StatusSlot implements Component {
  private readonly idle: Component
  private readonly busy: Loader
  private busyActive = false
  private busyStartedAt = 0
  toastText: string | undefined
  private idleLine = ''

  constructor(tui: TUI) {
    this.idle = new IdleStatus()
    // The busy message ("Deep diving...") renders in the web-brand gradient;
    // the Loader restyles the message on every spinner frame (80ms), so the
    // shimmer sweep rides those repaints for free — the text shimmers like
    // the web's animated gradient while a turn runs. DSH_TUI_ANIM=0 freezes
    // the static gradient.
    this.busy = new Loader(
      tui,
      (text: string) => fg('accent')(text),
      (text: string) => gradientText(
        text,
        BRAND,
        ICE,
        piTuiInternals.animFrameMs > 0 ? Date.now() - this.busyStartedAt : 0,
      ),
      'Working…',
    )
  }

  setBusy(busy: boolean): void {
    if (busy === this.busyActive) return
    this.busyActive = busy
    if (busy) {
      this.busyStartedAt = Date.now()
      this.busy.start()
    } else {
      this.busy.stop()
    }
  }

  setMessage(message: string): void {
    this.busy.setMessage(message)
  }

  /** Transient feedback while idle (P2); `undefined` restores blank lines. */
  setToast(text: string | undefined): void {
    this.toastText = text
  }

  /** The session stats strip shown in the idle slot (web StatsLine parity). */
  setIdleLine(line: string): void {
    this.idleLine = line
  }

  invalidate(): void {
    this.idle.invalidate()
    this.busy.invalidate()
  }

  render(width: number): string[] {
    if (this.busyActive) return this.busy.render(width)
    if (this.toastText !== undefined) return [truncateToWidth(this.toastText, width), '']
    if (this.idleLine !== '') return [truncateToWidth(this.idleLine, width), '']
    return this.idle.render(width)
  }
}

/** Terminal/TUI construction seam; tests substitute a headless fake. */
export const piTuiInternals: {
  createTerminal: () => Terminal
  createTui: (terminal: Terminal) => TUI
  /** Shimmer frame cadence in ms; 0 disables the brand + status animations. */
  animFrameMs: number
} = {
  createTerminal: () => new ProcessTerminal(),
  // The hardware cursor follows the composer/input caret, so IME candidate
  // windows anchor at the caret instead of the start of the input block.
  // Mouse capture is ON by default: SGR mouse reporting enables in-TUI wheel
  // scrolling (slash-menu wheel routing included) and native mouse
  // selection. Expansion toggles are keyboard-only (pi-style), so clicks are
  // never intercepted. It suppresses the host terminal's native right-click
  // menu and wheel behavior, so `DSH_TUI_MOUSE=0` opts back out;
  // PageUp/PageDown/arrow scrolling always works.
  // (TuiMainScreen has no layout engine, so the alt-screen renderer
  // is the only mode this surface can use — see DESIGN.md §10.)
  createTui: (terminal: Terminal) =>
    new TuiAltScreen(terminal, true, undefined, { mouse: process.env.DSH_TUI_MOUSE !== '0' }),
  // The DeepSeek brand/status shimmer repaints ~57 frames over 3.4s; opt
  // out for constrained terminals/tests with DSH_TUI_ANIM=0.
  animFrameMs: process.env.DSH_TUI_ANIM === '0' ? 0 : 60,
}

/** Paste-size gate: more lines than this asks for confirmation. */
const BIG_PASTE_LINES = 30
/** Ctrl+K fold: entries kept visible below the fold banner. */
const FOLD_KEEP = 30

/**
 * 子序列匹配打分（CC-03，Claude Code 式模糊补全）：query 逐字符按顺序命中
 * target 即得分，连续命中加权；不能按序命中返回 -1。调用方保证两者均已
 * lowercase。容忍拼写省略/笔误（`/quie` 仍能命中 `/quit`），前缀命中由
 * matchingCommands 额外加权，保证精确前缀永远排在模糊命中之前。
 */
function subsequenceScore(query: string, target: string): number {
  let qi = 0
  let score = 0
  let streak = 0
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) {
      qi++
      streak++
      score += 1 + streak * 2
    } else {
      streak = 0
    }
  }
  return qi === query.length ? score : -1
}

/**
 * 权限预设值按危险等级着色（CC-01，Claude Code 权限徽标语义）：full-access
 * 红、workspace-write 蓝、read-only 暗灰，一眼可辨当前权限面。
 */
function permissionTone(value: string): (text: string) => string {
  if (value.includes('full-access')) return (text: string) => fg('error')(text)
  if (value.includes('workspace-write')) return (text: string) => fg('info')(text)
  if (value.includes('read-only')) return (text: string) => fg('dim')(text)
  return (text: string) => fg('text')(text)
}

/** Searchable text for one entry (T2②). */
function entrySearchText(entry: ViewEntry): string {
  switch (entry.kind) {
    case 'user':
    case 'assistant':
    case 'notice':
      return entry.text
    case 'tool': {
      const output = entry.output?.blocks
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text as string)
        .join('\n') ?? ''
      return `${entry.name} ${entry.arguments} ${output}`
    }
    case 'goal':
      return entry.objective
    case 'todo':
      return entry.items.map(item => item.content).join('\n')
    case 'approval':
      return `${entry.toolName}`
    case 'status':
      return ''
  }
}

/** HH:MM clock from an entry timestamp (T3①). */
function clockFooter(at: number | undefined): string | undefined {
  if (at === undefined) return undefined
  const date = new Date(at)
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  // Same-day clock; earlier dates prefix MM-DD (or YYYY-MM-DD cross-year),
  // mirroring the web's message-chrome calendar-day split (A10).
  const now = new Date()
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
  if (sameDay) return italic(fg('dim')(`${hh}:${mm}`))
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const prefix = date.getFullYear() === now.getFullYear() ? `${month}-${day}` : `${date.getFullYear()}-${month}-${day}`
  return italic(fg('dim')(`${prefix} ${hh}:${mm}`))
}

/** One dim stats footer for an assistant entry (T1②) + produced files (T4②). */
function statsFooter(
  entry: { turn?: number; stats?: { runMs: number; ttftMs: number; tokensPerSecond?: number }; usage?: { inputTokens: number; outputTokens: number }; outcome?: TurnOutcome },
  doc: ViewDocument,
): string | undefined {
  const parts: string[] = []
  if (entry.stats !== undefined) {
    const fmt = (ms: number): string => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
    parts.push(`⏱ ${fmt(entry.stats.runMs)}`, `⚡ ${strings().ttft(fmt(entry.stats.ttftMs))}`)
    // stats.tokensPerSecond is identical in the web's zh/en tables
    // ('{throughput} tok/s'); like Deep diving..., it stays unlocalized.
    if (entry.stats.tokensPerSecond !== undefined) parts.push(`${entry.stats.tokensPerSecond} tok/s`)
  }
  // Files the same turn's tools produced (write/edit diff meta paths).
  if (entry.turn !== undefined) {
    const paths = new Set<string>()
    for (const other of doc.entries) {
      if (other.kind !== 'tool' || other.turn !== entry.turn) continue
      const meta = other.meta as { diffs?: Array<{ path: string }> } | undefined
      for (const diff of meta?.diffs ?? []) paths.add(diff.path)
    }
    if (paths.size > 0) {
      // OSC 8 hyperlinks make the produced-file chips openable (E14/B9);
      // the 📂 chip opens the containing folder in the host file manager
      // (H30 web "show in folder" parity via a directory OSC 8 link).
      const chips = [...paths].slice(0, 4).map(path => fileLink(path)).join(', ')
      const firstDir = dirname([...paths][0] ?? '')
      const folderChip = firstDir === '' || firstDir === '.'
        ? ''
        : ` ${fileLink(firstDir, '📂')}`
      parts.push(`✎ ${chips}${paths.size > 4 ? ` +${paths.size - 4}` : ''}${folderChip}`)
    }
  }
  const dim = parts.length === 0 ? undefined : italic(fg('dim')(parts.join(' · ')))
  // P0: the turn outcome badges the message instead of a floating notice row.
  if (entry.outcome === undefined) return dim
  const mark = entry.outcome.tone === 'error' ? fg('error')('✗') : fg('info')('⏹')
  const badge = `${mark} ${fg(entry.outcome.tone)(entry.outcome.text)}`
  return dim === undefined ? badge : `${dim} · ${badge}`
}

/** One dim wall-time footer for a tool entry (T3②). */
function toolDurationFooter(entry: { durationMs?: number }): string | undefined {
  if (entry.durationMs === undefined) return undefined
  return italic(fg('dim')(`⏱ ${entry.durationMs < 1000 ? `${entry.durationMs}ms` : `${(entry.durationMs / 1000).toFixed(1)}s`}`))
}

/** Frame-wrap a message view unless it is already keyboard-focusable (T3④). */
function frameOrSelf(view: Component, label: string): Component {
  return view instanceof CollapsibleMessage ? view : new FocusableFrame(view, label)
}

/** Entries the document flow renders as components. */
function isRenderedEntry(entry: ViewEntry): boolean {
  return entry.kind === 'user'
    || entry.kind === 'assistant'
    || entry.kind === 'tool'
    || entry.kind === 'approval'
    || entry.kind === 'notice'
    || (entry.kind === 'status' && entry.status !== 'working')
}

export interface PiTuiAppOptions {
  /** JSON history file the composer persists to (P2 2.4); off when omitted. */
  historyFile?: string
}

export class PiTuiApp implements TerminalApp {
  private readonly historyFile: string | undefined
  private history: string[] = []
  private busyStartedAt = 0
  /** Ctrl+K: view-level fold of older entries into one banner row. */
  private viewFolded = false
  private tui?: TUI
  private altScreen?: TuiAltScreen
  private terminal?: Terminal
  private editor?: Editor
  private handlers?: TerminalAppHandlers
  private meta: SurfaceMeta = { model: '?', session: '' }
  private removeInputListener?: () => void
  private current: ViewDocument = emptyDocument()

  private markdownTheme = getMarkdownTheme()
  private header?: Text
  private document?: Container
  private scrollView?: ScrollView
  private statusSlot?: StatusSlot
  private bottomPad = new BottomPad()
  private brandView = new BrandView(piTuiInternals.animFrameMs > 0 ? () => this.tui?.requestRender() : undefined)

  private entryViews = new Map<string, Component>()
  private entryOrder: string[] = []
  private lastEntry = new Map<string, ViewEntry>()
  private capabilityPanel = new CapabilityPanel()
  private footerLine = new FooterLine()
  /** -1 = composer; >= 0 = index into focusableCards (focus traversal). */
  private focusIndex = -1
  /** An overlay (picker/dialog) owns the keyboard while open. */
  private overlayOpen = false
  /** Ctrl+T toggles whether reasoning blocks render at all. */
  private hideThinking = false
  /** Messages queued upstream while a turn runs (T1⑤). */
  private queueCount = 0
  /** Live plugin session projections (K3): idle chips + the Ctrl+P picker. */
  private projections: readonly ProjectionRow[] = []
  /** The command catalog for the inline slash menu (cc/pi style). */
  private commandCatalog: readonly CommandChoice[] = []
  private slashMenu?: SlashMenu
  private slashMenuHandle?: OverlayHandle
  private slashMenuOpen = false
  private slashMenuIndex = 0
  /** The open session picker panel + its search debounce timer (H5). */
  private sessionPickerPanel?: FilterablePickerPanel
  private sessionSearchTimer?: ReturnType<typeof setTimeout>
  /** Background jobs reported by the runner (T1⑥). */
  private jobs: readonly JobRow[] = []
  /** Jobs collapsed to one row while more than one runs (P3, Ctrl+J). */
  private jobsExpanded = false
  /** Transient status-slot toast timer + pending styled text (P2). */
  private toastTimer?: ReturnType<typeof setTimeout>
  private pendingToast?: string
  /** 500ms idle ticker: live job clocks (E8) + the ↓ End hint (F2). */
  private idleTick?: ReturnType<typeof setInterval>
  private lastFollowingEnd = true
  /** Busy flag of the previous render (elapsed-time anchor). */
  private wasBusy = false

  constructor(options: PiTuiAppOptions = {}) {
    this.historyFile = options.historyFile
  }

  start(handlers: TerminalAppHandlers, meta: SurfaceMeta): void {
    this.handlers = handlers
    this.meta = meta
    const terminal = piTuiInternals.createTerminal()
    this.terminal = terminal
    const tui: TUI = piTuiInternals.createTui(terminal)
    this.tui = tui
    if (tui instanceof TuiAltScreen) this.altScreen = tui
    else this.altScreen = undefined
    this.hookAltScreen()

    this.header = new Text('', 0, 0)
    this.document = new Container()
    // The pad pushes short transcripts to the bottom (chat-style anchoring).
    this.document.addChild(this.bottomPad)
    // The DeepSeek brand splash sits above the transcript while the session
    // is still empty (renders zero rows once the conversation starts).
    this.document.addChild(this.brandView)
    // The transcript absorbs all remaining height; everything else keeps its
    // intrinsic size, so the composer is pinned to the bottom of the frame.
    this.scrollView = new ScrollView(this.document, {
      follow: 'end',
      primary: true,
      scrollbar: 'auto',
      scrollbarStyle: (text: string) => fg('scrollbarThumb')(text),
    })
    const statusSlot = new StatusSlot(tui)
    this.statusSlot = statusSlot

    const editor = new Editor(tui, getEditorTheme())
    this.loadHistory(editor)
    const submit = (text: string): void => {
      if (text === '/quit') handlers.onQuit()
      else if (text === '/new') handlers.onNewSessionRequest?.()
      else if (text === '') return
      // D2: DSH_TUI_ENTER=steer swaps busy-Enter to steer (web EnterBehaviorRow
      // semantics); the default stays queue (web default).
      else if (this.current.busy && process.env.DSH_TUI_ENTER === 'steer') handlers.onSteerRequest?.(text)
      else handlers.onInput(text)
    }
    const accept = (text: string): void => {
      editor.addToHistory(text)
      submit(text)
      // Slash commands are session controls, not conversation worth recalling.
      if (!text.startsWith('/')) this.persistHistory(text)
    }
    editor.onSubmit = (text: string) => {
      // `!command` runs a shell command and sends its output to the model;
      // `!!command` runs it silently (T5①, pi parity).
      if (text.startsWith('!!')) {
        void this.runShell(text.slice(2), true)
        return
      }
      if (text.startsWith('!')) {
        void this.runShell(text.slice(1), false)
        return
      }
      // A slash line executes through the command catalog: `/name args`
      // carries `args` inline (cc/pi style), no second dialog needed.
      if (text.startsWith('/')) {
        this.closeSlashMenu()
        const match = /^\/(\S*)\s?(.*)$/.exec(text)
        const typed = match?.[1] ?? text.slice(1)
        const rawInput = match?.[2] ?? ''
        // Resolve the typed token against the catalog (labels like
        // `/quit · 退出 TUI` map to the native `__quit` command, and
        // registered aliases like `exit` resolve to their canonical name).
        const resolved = typed === ''
          ? null
          : this.commandCatalog.find(item => item.value === typed)?.value
            ?? this.commandCatalog.find(item => item.aliases?.includes(typed))?.value
            ?? this.commandCatalog.find(item => item.label.slice(1).startsWith(`${typed} `))?.value
            ?? this.commandCatalog.find(item => item.label.slice(1).startsWith(typed))?.value
            ?? typed
        this.handlers?.onCommandPicked(resolved, rawInput)
        return
      }
      // A multi-line dump pasted at once is usually a mistake; confirm first.
      if (text.split('\n').length > BIG_PASTE_LINES) {
        void this.confirmBigPaste(text, accept)
        return
      }
      accept(text)
    }
    // File-path autocomplete on @/# only. The slash-command menu is the app's
    // own overlay palette (not pi's autocomplete): typing '/' opens it and the
    // follow-up keys filter it, so the upstream Enter-confirms-suggestion bug
    // in pi-tui 0.84.1 never applies to command input.
    editor.setAutocompleteProvider(new CombinedAutocompleteProvider([], this.meta.workspace ?? process.cwd()))
    editor.onChange = (text: string) => {
      this.updateSlashMenu(text)
    }
    this.editor = editor
    // Web-parity editor keys: Ctrl+Z undo / Ctrl+Shift+Z redo. pi defaults to
    // Ctrl+- / Alt+Y, and Ctrl+Y stays our rate key.
    getKeybindings().setUserBindings({ 'tui.editor.undo': 'ctrl+z', 'tui.editor.yankPop': 'ctrl+shift+z' })

    const layout = new VStack([
      this.header,
      new DynamicBorder((text: string) => fg('borderAccent')(text)),
      this.capabilityPanel,
      { component: this.scrollView, basis: 0, grow: 1, shrink: 1, minSize: 1 },
      statusSlot,
      new DynamicBorder((text: string) => fg('borderMuted')(text)),
      this.footerLine,
      editor,
    ])
    if (isViewportTUI(tui)) tui.setLayoutRoot(layout)

    this.attachInputListener(tui)

    tui.start()
    tui.setFocus(editor)
    this.applyState(this.current)
    tui.requestRender()
  }

  /** The app's global key handling (raw input no focused view consumed). */
  private handleGlobalKey(data: string): { consume: boolean } | undefined {
    if (this.handleSlashMenuKey(data)) return { consume: true }
    if (matchesKey(data, 'ctrl+c')) {
      // Claude-Code-style: Esc interrupts the running turn. Ctrl+C only
      // quits while idle (busy Ctrl+C is swallowed, not an interrupt).
      if (!this.current.busy) this.handlers?.onQuit()
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+r')) {
      this.handlers?.onSessionPickerRequest?.()
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+g')) {
      this.handlers?.onModelPickerRequest?.()
      return { consume: true }
    }
    // Terminal sends 0x1F for Ctrl+/; pi's key table maps ctrl+/ to 0x0F
    // (rawCtrlChar), so match the raw byte directly.
    if (data === '\x1f' || matchesKey(data, 'ctrl+/')) {
      this.handlers?.onCommandPickerRequest?.()
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+e') && this.current.planMode === true) {
      this.handlers?.onExitPlanModeRequest?.()
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+w')) {
      this.handlers?.onWorkspaceSwitchRequest?.()
      return { consume: true }
    }
    if (data === '\x06' || matchesKey(data, 'ctrl+f')) {
      void this.startSearch()
      return { consume: true }
    }
    if (data === '\x02' || matchesKey(data, 'ctrl+b')) {
      this.handlers?.onForkPickerRequest?.()
      return { consume: true }
    }
    if (data === '\x19' || matchesKey(data, 'ctrl+y')) {
      this.handlers?.onRateRequest?.()
      return { consume: true }
    }
    if (data === '\x18' || matchesKey(data, 'ctrl+x')) {
      this.copyLastReply()
      return { consume: true }
    }
    if ((data === '\x1b\r' || matchesKey(data, 'alt+enter')) && !this.overlayOpen && this.focusIndex === -1) {
      const text = this.editor?.getText() ?? ''
      if (text.trim() !== '') {
        this.editor?.setText('')
        this.handlers?.onSteerRequest?.(text)
      }
      return { consume: true }
    }
    if ((data === '\x1b\x1b[A' || matchesKey(data, 'alt+up')) && !this.overlayOpen && this.focusIndex === -1) {
      this.handlers?.onQueueRetrieveRequest?.()
      return { consume: true }
    }
    // Ctrl+O toggles the collapsed job row (Ctrl+J's byte \x0a is a newline
    // character the editor needs for multi-line paste, so it can't be a key).
    if ((data === '\x0f' || matchesKey(data, 'ctrl+o')) && !this.overlayOpen) {
      this.toggleJobsExpanded()
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+k')) {
      const visible = this.current.entries.filter(isRenderedEntry)
      if (visible.length > FOLD_KEEP) {
        this.viewFolded = !this.viewFolded
        this.applyState(this.current)
      }
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+p')) {
      this.handlers?.onPermissionPickerRequest?.()
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+t')) {
      this.hideThinking = !this.hideThinking
      for (const view of this.entryViews.values()) {
        const inner = view instanceof FocusableFrame ? view.inner : view
        if (inner instanceof AssistantMessageComponent) inner.setHideThinkingBlock(this.hideThinking)
      }
      this.tui?.requestRender()
      return { consume: true }
    }
    if (matchesKey(data, 'ctrl+d')) {
      this.handlers?.onQuit()
      return { consume: true }
    }
    if (matchesKey(data, 'tab') && !this.overlayOpen && this.focusableItems.length > 0) {
      this.cycleFocus()
      return { consume: true }
    }
    if (matchesKey(data, 'escape') && !this.overlayOpen && this.focusIndex >= 0) {
      this.setFocusIndex(-1)
      return { consume: true }
    }
    if (matchesKey(data, 'escape') && !this.overlayOpen && this.current.busy) {
      // Claude-Code-style interrupt: Esc cancels the running turn
      // (Alt+Up still retrieves a queued message).
      this.handlers?.onInterrupt()
      return { consume: true }
    }
    return undefined
  }

  /** Register the global key listener (re-attached after an editor resume). */
  private attachInputListener(tui: TUI): void {
    this.removeInputListener = tui.addInputListener((data: string) => {
      const result = this.handleGlobalKey(data)
      // F2: 任何输入（PgUp/End/滚轮）都可能翻转滚动跟随态：先同步提示，
      // 再重估 ticker（离开底部要启动轮询、回到底部要停掉）。
      this.syncBackToBottomHint()
      this.syncIdleTicker()
      return result
    })
  }

  /** 跟随态翻转时重算状态行（F2 回底提示；输入路径与 500ms ticker 共用）。 */
  private syncBackToBottomHint(): void {
    const following = this.scrollView?.isFollowingEnd ?? true
    if (following === this.lastFollowingEnd) return
    this.lastFollowingEnd = following
    this.applyStatusLines(this.current)
    this.tui?.requestRender()
  }

  render(doc: ViewDocument): void {
    this.current = doc
    this.applyState(doc)
    this.tui?.requestRender()
  }

  reset(): void {
    const document = this.document
    if (document !== undefined) {
      for (const view of this.entryViews.values()) document.removeChild(view)
      // Re-append the fixed chrome so it stays first (re-adding without
      // removal would stack duplicate pads across session swaps).
      document.removeChild(this.bottomPad)
      document.removeChild(this.brandView)
      document.addChild(this.bottomPad)
      document.addChild(this.brandView)
    }
    this.entryViews.clear()
    this.entryOrder = []
    this.lastEntry.clear()
    this.pendingToast = undefined
    // Drop the previous session's view state before re-rendering the next.
    this.current = emptyDocument()
    this.wasBusy = false
    this.queueCount = 0
    this.editor?.setText('')
    this.applyState(this.current)
  }

  stop(): void {
    this.removeInputListener?.()
    this.removeInputListener = undefined
    if (this.toastTimer !== undefined) {
      clearTimeout(this.toastTimer)
      this.toastTimer = undefined
    }
    if (this.idleTick !== undefined) {
      clearInterval(this.idleTick)
      this.idleTick = undefined
    }
    this.brandView.stop()
    // TuiAltScreen.stop() restores the alternate buffer and the terminal.
    this.tui?.stop()
    this.tui = undefined
    this.altScreen = undefined
    this.terminal = undefined
  }

  /** Current scroll offset of the transcript (test/debug hook). */
  get scrollTop(): number {
    return this.scrollView?.scrollTop ?? 0
  }

  /** Number of entry views currently mounted (test/debug hook). */
  get viewCount(): number {
    return this.entryOrder.length
  }

  showSessionPicker(items: readonly SessionChoice[]): void {
    this.sessionPickerPanel = this.showChoicePicker('会话切换', items.map(item => ({
      value: item.value,
      label: item.label,
      description: item.description,
      current: item.current ?? item.value === this.meta.session,
    })), (value) => { this.handlers?.onSessionPicked(value) }, (query) => {
      // H5: 250ms debounce, then the runner merges backend full-text hits.
      if (this.sessionSearchTimer !== undefined) clearTimeout(this.sessionSearchTimer)
      this.sessionSearchTimer = setTimeout(() => {
        this.handlers?.onSessionSearchRequest?.(query)
      }, 250)
    })
  }

  /** Feed backend full-text search results into the open session picker (H5). */
  setSessionPickerRows(rows: readonly SessionChoice[]): void {
    this.sessionPickerPanel?.setRows(rows.map(item => {
      const current = item.current ?? item.value === this.meta.session
      return {
        value: item.value,
        label: current === true ? `● ${item.label}` : `  ${item.label}`,
        description: item.description,
        current,
      }
    }))
    this.tui?.requestRender()
  }

  showModelPicker(items: readonly ModelChoice[]): void {
    this.showChoicePicker(strings().pickModel, items.map(item => ({
      value: item.value,
      label: item.label,
      description: item.description,
      current: item.current ?? item.value === this.meta.model,
    })), (value) => { this.handlers?.onModelPicked(value) })
  }

  showForkPicker(items: readonly SessionChoice[]): void {
    this.showChoicePicker('分支点 · 从所选消息起开新会话', items.map(item => ({
      value: item.value,
      label: item.label,
      description: item.description,
    })), (value) => { this.handlers?.onForkPicked(value === null ? null : Number(value)) })
  }

  /** Push the command catalog for the inline slash menu (cc/pi style). */
  setCommands(items: readonly CommandChoice[]): void {
    this.commandCatalog = [...items]
    if (this.slashMenuOpen) this.updateSlashMenu(this.editor?.getText() ?? '')
  }

  /** Catalog rows matching the current slash query (name, alias, or label). */
  private matchingCommands(query: string): CommandChoice[] {
    if (query === '') return [...this.commandCatalog]
    const scored: Array<{ item: CommandChoice; score: number }> = []
    for (const item of this.commandCatalog) {
      const label = item.label.startsWith('/') ? item.label.slice(1).toLowerCase() : item.label.toLowerCase()
      const candidates = [item.value, ...(item.aliases ?? []), label]
      let best = -1
      for (const candidate of candidates) {
        const prefix = candidate.startsWith(query) ? 4 : 0 // 前缀命中优先
        const fuzzy = subsequenceScore(query, candidate)
        if (fuzzy >= 0 && prefix + fuzzy > best) best = prefix + fuzzy
      }
      if (best >= 0) scored.push({ item, score: best })
    }
    // 稳定排序：同分保持目录原序（value → alias → label 的命中优先级已由
    // best 的最大化保证，不再需要 kind 维度）。
    return scored.sort((a, b) => b.score - a.score).map(entry => entry.item)
  }

  /** Open/refresh the non-capturing slash menu above the composer. */
  private updateSlashMenu(text: string): void {
    const token = /^\/(\S*)$/.exec(text)
    if (token === null || this.tui === undefined) {
      this.closeSlashMenu()
      return
    }
    const query = token[1].toLowerCase()
    const items: SlashMenuItem[] = this.matchingCommands(query)
      .map((item) => {
        // The display word comes from the label (`/new · 新会话` → `new`);
        // the internal value (e.g. `__new`) resolves on submit.
        const rest = item.label.startsWith('/') ? item.label.slice(1) : item.label
        const [name, ...tail] = rest.split(' ')
        return {
          name,
          ...tail.length > 0 ? { hint: tail.join(' ') } : {},
          description: item.description,
        }
      })
    if (!this.slashMenuOpen) {
      const menu = new SlashMenu(items)
      this.slashMenu = menu
      this.slashMenuOpen = true
      this.slashMenuIndex = 0
      this.slashMenuHandle = this.tui.showOverlay(menu, {
        anchor: 'bottom-left', offsetY: -6, maxHeight: '40%', width: this.overlayWidth - 8,
        nonCapturing: true,
      })
    } else {
      this.slashMenu?.setItems(items)
      this.slashMenuIndex = Math.min(this.slashMenuIndex, Math.max(0, items.length - 1))
      if (this.slashMenu !== undefined) this.slashMenu.selectedIndex = this.slashMenuIndex
      this.tui.requestRender()
    }
  }

  private closeSlashMenu(): void {
    if (!this.slashMenuOpen) return
    this.slashMenuOpen = false
    this.slashMenu = undefined
    this.slashMenuHandle?.hide()
    this.slashMenuHandle = undefined
  }

  /** Up/Down/Esc/Tab while the slash menu is open (the editor keeps focus). */
  private handleSlashMenuKey(data: string): boolean {
    if (!this.slashMenuOpen || this.slashMenu === undefined || this.slashMenuHandle === undefined) return false
    if (matchesKey(data, 'up')) {
      this.slashMenuIndex = Math.max(0, this.slashMenuIndex - 1)
      this.slashMenu.selectedIndex = this.slashMenuIndex
      this.tui?.requestRender()
      return true
    }
    if (matchesKey(data, 'down')) {
      const items = this.slashMenuItemsCount()
      this.slashMenuIndex = Math.min(items - 1, this.slashMenuIndex + 1)
      this.slashMenu.selectedIndex = this.slashMenuIndex
      this.tui?.requestRender()
      return true
    }
    if (matchesKey(data, 'escape')) {
      this.closeSlashMenu()
      this.editor?.setText('')
      return true
    }
    if (matchesKey(data, 'tab')) {
      // Complete the selected command name into the composer. Native rows
      // carry `__`-prefixed internal values (`__model`, `__help`, …) but
      // display real names in their labels, so the completion inserts the
      // DISPLAY name — `/model` reads back as `/model`, not `/__model`.
      const token = /^\/(\S*)$/.exec(this.editor?.getText() ?? '')?.[1]?.toLowerCase() ?? ''
      const picked = this.matchingCommands(token)[this.slashMenuIndex]
      if (picked !== undefined) {
        const rest = picked.label.startsWith('/') ? picked.label.slice(1) : picked.label
        const displayName = rest.split(' ')[0] ?? picked.value
        this.editor?.setText(`/${displayName} `)
      }
      return true
    }
    return false
  }

  /**
   * Instance-level hook over pi's TuiAltScreen (no node_modules patch):
   * while the slash menu is open, the mouse wheel scrolls the MENU instead
   * of the transcript. Expansion toggles are keyboard-only (pi-style), so
   * left clicks are NOT intercepted — pi's native selection/scroll behavior
   * owns them. `routeWheel` is a prototype method, so assigning an instance
   * property shadows it for this app only.
   */
  private hookAltScreen(): void {
    const altScreen = this.altScreen
    if (altScreen === undefined) return
    // pi declares these private; the hook shadows them at runtime through a
    // structural view (the method names/arity are pi's public surface).
    const alt = altScreen as unknown as {
      routeWheel(event: { direction: number; x: number; y: number }): void
      handleViewportInput(data: string): { consume: boolean } | undefined
    }
    const routeWheel = alt.routeWheel.bind(altScreen)
    alt.routeWheel = (event: { direction: number; x: number; y: number }) => {
      if (this.slashMenuOpen && this.slashMenu !== undefined) {
        this.slashMenu.scrollBy(-event.direction * 3)
        this.slashMenuIndex = this.slashMenu.selectedIndex
        this.tui?.requestRender()
        return
      }
      routeWheel(event)
      this.syncBackToBottomHint()
    }
    // pi 在构造期第一个注册了 handleViewportInput 并 consume 掉 PgUp/End 等
    // 视口键——我们自己的输入监听器收不到这些键。包装它：滚动处理照旧，
    // 处理完同步 ↓ End 提示与 ticker 状态（F2）。
    const handleViewportInput = alt.handleViewportInput.bind(altScreen)
    alt.handleViewportInput = (data: string) => {
      const result = handleViewportInput(data)
      this.syncBackToBottomHint()
      this.syncIdleTicker()
      return result
    }
  }

  private slashMenuItemsCount(): number {
    const text = this.editor?.getText() ?? ''
    const token = /^\/(\S*)$/.exec(text)?.[1]?.toLowerCase() ?? ''
    return Math.max(1, this.matchingCommands(token).length)
  }

  showCommandPicker(items: readonly CommandChoice[]): void {
    this.showChoicePicker('命令', items.map(item => ({
      value: item.value,
      label: item.label,
      description: item.description,
    })), (value) => { this.handlers?.onCommandPicked(value) })
  }

  showQueuePicker(rows: readonly PickerRow[], onPicked: (value: string | null) => void, title = '队列 · 选择一条排队消息'): void {
    this.showChoicePicker(title, rows, onPicked)
  }

  showPermissionPicker(items: readonly PermissionChoice[]): void {
    this.showChoicePicker(`${strings().permission} · ${strings().permissionDescription}`, items.map(item => ({
      value: item.value,
      label: item.label,
      description: item.description,
      current: item.current,
    })), (value) => { this.handlers?.onPermissionPicked(value) })
  }

  /** Store the live plugin projections and repaint the idle chips (K3). */
  setProjections(rows: readonly ProjectionRow[]): void {
    this.projections = [...rows]
    if (this.tui !== undefined) {
      this.applyState(this.current)
      this.tui.requestRender()
    }
  }

  /** Open the sectioned /hotkeys reference panel (grouped, aligned columns). */
  showHotkeys(): void {
    const tui = this.tui
    if (tui === undefined) return
    const panel = new HotkeysPanel(strings().hotkeysSections, () => {
      this.overlayOpen = false
      handle.hide()
    })
    this.overlayOpen = true
    // The panel owns keyboard focus (Esc/Enter/q close, arrows scroll) and
    // restores the composer focus on hide — the same identity trick the
    // picker panels use.
    const handle = tui.showOverlay(panel, {
      anchor: 'bottom-left', offsetY: -6, maxHeight: '50%', width: this.overlayWidth - 8,
    })
    tui.setFocus(panel)
  }

  /** One searchable overlay for every chooser; rows mark the current value. */
  private showChoicePicker(
    title: string,
    rows: readonly PickerRow[],
    onPicked: (value: string | null) => void,
    onFilter?: (query: string) => void,
  ): FilterablePickerPanel | undefined {
    const tui = this.tui
    if (tui === undefined) return undefined
    const marked: PickerRow[] = rows.map(row => ({
      ...row,
      label: row.current === true ? `● ${row.label}` : `  ${row.label}`,
    }))
    const panel = new FilterablePickerPanel(title, marked, (value) => {
      this.overlayOpen = false
      handle.hide()
      onPicked(value)
    }, onFilter)
    this.overlayOpen = true
    // Anchor above the composer (like the approval dialog), not mid-screen:
    // the menu reads next to where the user types.
    const handle = tui.showOverlay(panel, { anchor: 'bottom-left', offsetY: -6, maxHeight: '50%', width: this.overlayWidth - 8 })
    // The panel is the overlay's own component, so focusing it keeps hide()'s
    // focus-restore identity intact while guaranteeing input reaches it.
    tui.setFocus(panel)
    return panel
  }

  /** The active agent's provider/model split from the header meta. */
  private modelIdentity(): { provider: string; model: string } {
    const slash = this.meta.model.indexOf('/')
    if (slash === -1) return { provider: 'dsh', model: this.meta.model }
    return { provider: this.meta.model.slice(0, slash), model: this.meta.model.slice(slash + 1) }
  }

  /** Mount one component for an entry. */
  private createEntryView(entry: ViewEntry): Component | undefined {
    const tui = this.tui
    if (tui === undefined) return undefined
    switch (entry.kind) {
      case 'user': {
        const inner = new UserMessageComponent(entry.text, this.markdownTheme, 1, [codeLabelTransformer, mermaidTransformer])
        inner.setFooter(clockFooter(entry.at))
        return frameOrSelf(maybeCollapse(inner, entry.text), '用户消息')
      }
      case 'assistant': {
        const { provider, model } = this.modelIdentity()
        const inner = new AssistantMessageComponent(
          synthesizeAssistantMessage(entry, provider, model),
          this.hideThinking,
          this.markdownTheme,
          'Thinking…',
          1,
          [codeLabelTransformer, mermaidTransformer],
        )
        const stats = statsFooter(entry, this.current)
        const clock = clockFooter(entry.at)
        inner.setFooter(stats === undefined ? clock : `${stats} · ${clock ?? ''}`.trimEnd())
        return frameOrSelf(maybeCollapse(inner, entry.text, entry.state !== 'streaming'), '助手回复')
      }
      case 'approval':
        return new FocusableFrame(new ApprovalEntryView(entry), '审批')
      case 'tool': {
        const view = new ToolExecutionComponent(
          entry.name,
          entry.callId,
          toolArgs(entry.arguments),
          { showImages: false },
          resolveToolDefinition(entry.name),
          tui,
          this.meta.workspace ?? process.cwd(),
        )
        view.markExecutionStarted()
        view.setArgsComplete()
        if (entry.state !== 'running' && entry.output !== undefined) {
          view.updateResult(synthesizeToolResult(entry))
        }
        const card = new FocusableToolCard(view)
        card.setFooter(toolDurationFooter(entry))
        card.setChildren(entry.children)
        return card
      }
      case 'notice':
        return entry.detail === undefined
          ? new FocusableFrame(new NoticeEntryView(entry), '通知')
          : new ExpandableNoticeView(entry)
      case 'status':
        if (entry.status === 'retry') {
          const detail = entry.detail as { attempt: number; maxAttempts: number; delayMs: number; failure?: { code: string; message: string } }
          const indicator = new RetryStatusIndicator(tui, detail.attempt, detail.maxAttempts, detail.delayMs)
          return detail.failure === undefined
            ? indicator
            : new FocusableRetryRow(indicator, detail.failure)
        }
        if (entry.status === 'compaction') {
          const detail = entry.detail as { summaryText: string; shadowedTokenCount: number }
          return new CompactionSummaryMessageComponent(
            { tokensBefore: detail.shadowedTokenCount, summary: detail.summaryText },
            this.markdownTheme,
          )
        }
        return undefined
      default:
        return undefined
    }
  }

  /** Update a mounted component in place for a changed entry. */
  private updateEntryView(view: Component, entry: ViewEntry, doc: ViewDocument): void {
    if (entry.kind === 'approval') {
      const inner = view instanceof FocusableFrame ? view.inner : view
      if (inner instanceof ApprovalEntryView) inner.setEntry(entry)
    } else if (entry.kind === 'assistant' && (view instanceof AssistantMessageComponent || (view instanceof FocusableFrame && view.inner instanceof AssistantMessageComponent))) {
      const raw = view instanceof FocusableFrame ? view.inner as AssistantMessageComponent : view
      const { provider, model } = this.modelIdentity()
      raw.setHideThinkingBlock(this.hideThinking)
      raw.updateContent(synthesizeAssistantMessage(entry, provider, model), entry.state === 'streaming')
      const statsLine = statsFooter(entry, doc)
      const clock = clockFooter(entry.at)
      raw.setFooter(statsLine === undefined ? clock : `${statsLine} · ${clock ?? ''}`.trimEnd())
      // Streaming finished with a long message: swap in the fold wrapper.
      const wrapped = maybeCollapse(raw, entry.text, entry.state !== 'streaming')
      if (wrapped !== raw) {
        this.document?.removeChild(view)
        this.document?.addChild(wrapped)
        this.entryViews.set(entry.id, wrapped)
        wrapped.invalidate()
      }
    } else if (entry.kind === 'assistant' && view instanceof AssistantMessageComponent) {
      const { provider, model } = this.modelIdentity()
      view.setHideThinkingBlock(this.hideThinking)
      view.updateContent(synthesizeAssistantMessage(entry, provider, model), entry.state === 'streaming')
      const statsLine = statsFooter(entry, doc)
      const clock = clockFooter(entry.at)
      view.setFooter(statsLine === undefined ? clock : `${statsLine} · ${clock ?? ''}`.trimEnd())
      // Streaming finished with a long message: swap in the fold wrapper.
      const wrapped = maybeCollapse(view, entry.text, entry.state !== 'streaming')
      if (wrapped !== view) {
        this.document?.removeChild(view)
        this.document?.addChild(wrapped)
        this.entryViews.set(entry.id, wrapped)
        wrapped.invalidate()
      }
    } else if (entry.kind === 'assistant' && view instanceof CollapsibleMessage) {
      const { provider, model } = this.modelIdentity()
      const inner = new AssistantMessageComponent(
        synthesizeAssistantMessage(entry, provider, model),
        this.hideThinking,
        this.markdownTheme,
        'Thinking…',
        1,
        [codeLabelTransformer],
      )
      const statsLine = statsFooter(entry, doc)
      const clock = clockFooter(entry.at)
      inner.setFooter(statsLine === undefined ? clock : `${statsLine} · ${clock ?? ''}`.trimEnd())
      view.replaceInner(inner, entry.text)
    } else if (entry.kind === 'tool' && view instanceof FocusableToolCard) {
      if (entry.state !== 'running' && entry.output !== undefined) {
        view.inner.updateResult(synthesizeToolResult(entry))
      }
      view.setFooter(toolDurationFooter(entry))
      view.setChildren(entry.children)
    } else if (entry.kind === 'status' && entry.status === 'retry') {
      // The retry row carries live policy state; fold updates (a second
      // `llm/retry`, or `llm/retry-started` with the countdown elapsed)
      // rebuild the row so the attempt count and failure reason track.
      const detail = entry.detail as { attempt: number; maxAttempts: number; delayMs: number; failure?: { code: string; message: string } }
      const tui = this.tui
      if (tui === undefined) return
      const indicator = new RetryStatusIndicator(tui, detail.attempt, detail.maxAttempts, detail.delayMs)
      const rebuilt = detail.failure === undefined ? indicator : new FocusableRetryRow(indicator, detail.failure)
      if (view instanceof FocusableRetryRow) view.inner.dispose()
      if (view instanceof RetryStatusIndicator) view.dispose()
      this.document?.removeChild(view)
      this.document?.addChild(rebuilt)
      this.entryViews.set(entry.id, rebuilt)
      rebuilt.invalidate()
    } else if (entry.kind === 'notice') {
      if (view instanceof ExpandableNoticeView) {
        view.setEntry(entry)
        return
      }
      const inner = view instanceof FocusableFrame ? view.inner : view
      if (inner instanceof NoticeEntryView) inner.setEntry(entry)
    }
  }

  /** The mounted tool cards in document order (focus traversal targets). */
  private get focusableCards(): FocusableToolCard[] {
    const cards: FocusableToolCard[] = []
    for (const key of this.entryOrder) {
      const view = this.entryViews.get(key)
      if (view instanceof FocusableToolCard) cards.push(view)
    }
    return cards
  }

  /** Everything Tab can reach: cards, collapsed messages, and message frames. */
  private get focusableItems(): Array<FocusableToolCard | FocusableRetryRow | CollapsibleMessage | FocusableFrame | ExpandableNoticeView> {
    const items: Array<FocusableToolCard | FocusableRetryRow | CollapsibleMessage | FocusableFrame | ExpandableNoticeView> = []
    for (const key of this.entryOrder) {
      const view = this.entryViews.get(key)
      if (view instanceof FocusableToolCard || view instanceof FocusableRetryRow || view instanceof CollapsibleMessage || view instanceof FocusableFrame || view instanceof ExpandableNoticeView) items.push(view)
    }
    return items
  }

  /** Move focus between the composer (-1) and the focusable entries. */
  private cycleFocus(): void {
    const items = this.focusableItems
    if (items.length === 0) return
    if (this.focusIndex >= items.length) this.focusIndex = -1
    // Enter at the newest item, then walk downward through older ones, and
    // wrap back to the composer after the oldest — one pass visits every row.
    const next = this.focusIndex === -1
      ? items.length - 1
      : this.focusIndex - 1
    this.setFocusIndex(next < 0 ? -1 : next)
  }

  private setFocusIndex(index: number): void {
    this.focusIndex = index
    const items = this.focusableItems
    for (let i = 0; i < items.length; i++) items[i].focused = i === index
    const target = index === -1 ? this.editor : items[index]
    if (target !== undefined) this.tui?.setFocus(target)
    this.refreshFooter()
    this.tui?.requestRender()
  }

  /** Recompute the fixed status rows under the input line. */
  private refreshFooter(): void {
    this.footerLine.set(this.current, this.meta.workspace ?? process.cwd(),
      statsStrip(this.current, strings()) ?? '', {
        contextWindow: this.meta.contextWindow,
        model: this.meta.model,
      })
  }

  /** Reconcile the mounted views with one document snapshot (incremental by entry identity). */
  private applyState(doc: ViewDocument): void {
    const editor = this.editor
    if (this.tui === undefined || editor === undefined) return

    if (this.header !== undefined) {
      const session = this.meta.session === ''
        ? 'new session'
        : this.meta.session.length <= 12 ? this.meta.session : `…${this.meta.session.slice(-12)}`
      const parent = this.meta.parentSession === undefined
        ? ''
        : ` ${fg('dim')('↳')} ${fg('muted')(this.meta.parentSession.length <= 12 ? this.meta.parentSession : `…${this.meta.parentSession.slice(-12)}`)}`
      const title = doc.title === undefined ? '' : ` · ${fg('text')(doc.title.length <= 24 ? doc.title : `${doc.title.slice(0, 23)}…`)}`
      const planBadge = doc.planMode === true ? ` ${fg('dim')('│')} ${fg('warning')('◐ plan')}` : ''
      this.header.setText(`${fg('accent')('▍')} ${bold(fg('accent')('dsh tui'))} ${fg('dim')('│')} ${fg('muted')(session)}${parent}${title}${planBadge}`)
    }

    let desired = doc.entries.filter(isRenderedEntry)
    // P1: consecutive same-type system notices render as one row (×N); the
    // document stays append-only — only the view converges.
    desired = convergeNotices(desired)
    // The brand splash shows only while the session has no messages yet.
    this.brandView.setVisible(shouldShowBrand(doc))
    if (this.viewFolded && desired.length > FOLD_KEEP) {
      const hidden = desired.length - FOLD_KEEP
      const banner: ViewEntry = {
        kind: 'notice', id: 'folded-banner',
        text: `… 已折叠 ${hidden} 条更早消息（Ctrl+K 展开）`,
        tone: 'info',
      }
      desired = [banner, ...desired.slice(-FOLD_KEEP)]
    }
    const desiredKeys = new Set(desired.map(entry => entry.id))
    for (const entry of desired) {
      const existing = this.entryViews.get(entry.id)
      if (existing === undefined) {
        const view = this.createEntryView(entry)
        if (view === undefined) continue
        this.entryViews.set(entry.id, view)
        this.entryOrder.push(entry.id)
        this.lastEntry.set(entry.id, entry)
        this.document?.addChild(view)
      } else if (this.lastEntry.get(entry.id) !== entry) {
        this.updateEntryView(existing, entry, doc)
        this.lastEntry.set(entry.id, entry)
      }
    }
    for (const key of [...this.entryOrder]) {
      if (desiredKeys.has(key)) continue
      const view = this.entryViews.get(key)
      if (view !== undefined) {
        this.document?.removeChild(view)
        this.entryViews.delete(key)
        this.lastEntry.delete(key)
        this.entryOrder.splice(this.entryOrder.indexOf(key), 1)
      }
    }

    this.refreshFooter()

    const goal = doc.entries.find((entry): entry is Extract<ViewEntry, { kind: 'goal' }> => entry.kind === 'goal')
    const todo = doc.entries.find((entry): entry is Extract<ViewEntry, { kind: 'todo' }> => entry.kind === 'todo')
    this.capabilityPanel.set(goal, todo, this.jobs, doc.workflow)

    if (this.statusSlot !== undefined) this.applyStatusLines(doc)
    // P2: a toast raised while a turn ran is flushed the moment it ends.
    if (this.wasBusy && !doc.busy && this.pendingToast !== undefined) {
      const toast = this.pendingToast
      this.pendingToast = undefined
      this.showToast(toast)
    }
    // Enter submits while busy too: the runner queues the message (web
    // Enter-as-Queue semantics), so the composer never needs buffering.
    editor.disableSubmit = false
    this.wasBusy = doc.busy
    this.updateBottomPadding()
    this.syncIdleTicker()
  }

  /**
   * 状态槽两态文案（F2 回底提示的载体）：busy 时跑计时/队列数，idle 时渲染
   * 投影 chips/权限预设；当滚动视口离开底部时追加 `↓ 回到底部 (End)`——
   * pi 的 followEnd 在构造期固定，自动滚动开关不可行，用可见提示补上
   * 「已离开底部」的可感知性（End 键原生回底）。
   * 与 applyState 分离，供 500ms ticker 在跟随态翻转时局部刷新。
   */
  private applyStatusLines(doc: ViewDocument): void {
    const slot = this.statusSlot
    if (slot === undefined) return
    const offBottom = !(this.scrollView?.isFollowingEnd ?? true)
    const endHint = offBottom ? ` · ${fg('dim')(`↓ ${strings().backToBottom} (End)`)}` : ''
    if (doc.busy) {
      // The fixed slot ABOVE the input line carries running state only
      // (web: the composer area itself never shows the stats strip — it
      // lives in the composer.dock under the input line, our footer).
      // Shortcut hints deliberately do not render here (see /hotkeys).
      if (!this.wasBusy) this.busyStartedAt = Date.now()
      const seconds = Math.floor((Date.now() - this.busyStartedAt) / 1000)
      // Web parity: "Deep diving..." plus a clock only after 15 seconds
      // (formatRunDuration with the web's duration templates).
      const clock = seconds >= 15
        ? seconds >= 60
          ? strings().durationMinutes(Math.floor(seconds / 60), String(seconds % 60).padStart(2, '0'))
          : strings().durationSeconds(seconds)
        : ''
      const diving = clock === '' ? strings().diving : `${strings().diving} ${clock}`
      const queued = this.queueCount > 0 ? ` · ${strings().queued(this.queueCount)}` : ''
      slot.setMessage(`${diving}${queued}${endHint}`)
    } else {
      slot.setMessage(strings().diving)
    }
    // The fixed slot above the input line: running state while busy, the
    // plugin projections while idle (web composer-chip parity). The generic
    // projection chips (K3) win; the fold-derived permission preset is the
    // fallback when no projection registry is composed.
    const projectionLine = this.projections
      .map((row) => {
        const label = row.key === 'permissions' ? strings().permission : row.key
        const current = row.options.find(option => option.value === row.currentValue)?.name ?? row.currentValue
        // CC-01：permissions 投影的当前值按危险等级分色，其余投影保持中性。
        const styled = row.key === 'permissions' ? permissionTone(row.currentValue)(current) : fg('text')(current)
        return `ℹ ${fg('info')(label)}：${styled}`
      })
      .join(' · ')
    const idleBase = this.projections.length > 0
      ? projectionLine
      : doc.permissionPreset === undefined
        ? ''
        : `ℹ ${fg('info')('权限预设')}：${permissionTone(doc.permissionPreset)(doc.permissionPreset)}`
    slot.setIdleLine(offBottom && idleBase === ''
      ? `${fg('dim')(`↓ ${strings().backToBottom} (End)`)}`
      : `${idleBase}${endHint}`)
    slot.setBusy(doc.busy)
  }

  /** Bottom-anchor the transcript when it is shorter than the viewport (T7). */
  private updateBottomPadding(): void {
    const scroll = this.scrollView
    if (scroll === undefined) return
    const width = this.terminal?.columns ?? 100
    let content = 0
    for (const key of this.entryOrder) {
      const view = this.entryViews.get(key)
      if (view !== undefined) content += view.render(width).length
    }
    const pad = Math.max(0, scroll.viewportHeight - content)
    this.bottomPad.setHeight(pad)
  }

  /** Put a retrieved queued message back into the composer (T5②). */
  restoreToEditor(text: string): void {
    this.editor?.setText(text)
    this.setFocusIndex(-1)
    this.tui?.requestRender()
  }

  /** The runner reports the pending message queue length (T1⑤). */
  notifyQueue(count: number): void {
    this.queueCount = count
    if (this.tui === undefined) return
    this.applyState(this.current)
    this.tui.requestRender()
  }

  /** The runner reports the session's background jobs (T1⑥). */
  showJobs(rows: readonly JobRow[]): void {
    this.jobs = [...rows]
    if (this.tui === undefined) return
    this.applyState(this.current)
    this.syncIdleTicker()
    this.tui.requestRender()
  }

  /**
   * Start/stop the light idle ticker: it repaints while a job runs (live
   * durations) or the transcript sits off-bottom (↓ End hint). Job clocks are
   * animation-driven (skipped with animFrameMs=0 so tests stay deterministic);
   * the off-bottom poll is state refresh, not animation, so it keeps running
   * even with animations frozen — otherwise DSH_TUI_ANIM=0 would silently
   * lose the back-to-bottom hint.
   */
  private syncIdleTicker(): void {
    const jobsRunning = this.jobs.some(job => job.status === 'running' || job.status === 'stopping')
    const offBottom = !(this.scrollView?.isFollowingEnd ?? true)
    const needed = (piTuiInternals.animFrameMs > 0 && jobsRunning) || offBottom
    if (needed && this.idleTick === undefined) {
      this.idleTick = setInterval(() => {
        this.syncBackToBottomHint()
        const running = this.jobs.some(job => job.status === 'running' || job.status === 'stopping')
        if (running) {
          this.refreshFooter()
          this.tui?.requestRender()
        }
        const following = this.scrollView?.isFollowingEnd ?? true
        if (!running && following && this.idleTick !== undefined) {
          clearInterval(this.idleTick)
          this.idleTick = undefined
        }
      }, 500)
    } else if (!needed && this.idleTick !== undefined) {
      clearInterval(this.idleTick)
      this.idleTick = undefined
    }
  }

  /**
   * Transient action feedback in the status slot (P2). While a turn runs
   * the toast defers until the busy→idle edge; otherwise it shows for 2.5s.
   */
  toast(text: string, tone: 'info' | 'error' | 'success' = 'info'): void {
    const mark = tone === 'error'
      ? fg('error')('✗')
      : tone === 'success' ? fg('success')('✓') : fg('info')('ℹ')
    const body = fg(tone === 'error' ? 'error' : tone === 'success' ? 'success' : 'muted')(text)
    const styled = `${mark} ${body}`
    if (this.current.busy) {
      this.pendingToast = styled
      return
    }
    this.showToast(styled)
  }

  /** Show one toast for 2.5s, then restore the idle status slot. */
  private showToast(styled: string): void {
    if (this.toastTimer !== undefined) clearTimeout(this.toastTimer)
    this.statusSlot?.setToast(styled)
    this.tui?.requestRender()
    this.toastTimer = setTimeout(() => {
      this.toastTimer = undefined
      this.statusSlot?.setToast(undefined)
      this.tui?.requestRender()
    }, 2500)
  }

  /** Ctrl+O expands/collapses the multi-job row in the capability panel (P3). */
  toggleJobsExpanded(): void {
    this.jobsExpanded = !this.jobsExpanded
    this.capabilityPanel.setJobsExpanded(this.jobsExpanded)
    this.tui?.requestRender()
  }

  /** Whether a transient toast is currently in the status slot (test hook). */
  get toastVisible(): boolean {
    return this.statusSlot?.toastText !== undefined
  }

  /** Refresh path-bound views after a workspace switch (T2④). */
  setWorkspace(path: string): void {
    this.editor?.setAutocompleteProvider(new CombinedAutocompleteProvider([], path))
    this.applyState(this.current)
    this.tui?.requestRender()
  }

  /** Ctrl+F: query → match list → jump the transcript to the picked match (T2②). */
  private async startSearch(): Promise<void> {
    const answer = await this.askDialog({ title: strings().search, options: [] })
    if (answer.reason !== 'picked' || answer.picked === undefined) return
    const query = answer.picked.trim()
    if (query === '') return
    const matches = this.searchEntries(query)
    if (matches.length === 0) {
      await this.askDialog({ title: '无匹配', options: [strings().ok] })
      return
    }
    this.showChoicePicker(`搜索结果 · ${matches.length} 处`, matches.map(match => ({
      value: match.entryId,
      label: match.preview,
    })), (value) => {
      if (value !== null) this.jumpToEntry(value)
    })
  }

  /** Search every renderable entry's visible text; returns entry-scoped hits. */
  private searchEntries(query: string): Array<{ entryId: string; preview: string }> {
    const needle = query.toLowerCase()
    const results: Array<{ entryId: string; preview: string }> = []
    for (const entry of this.current.entries) {
      const text = entrySearchText(entry)
      const index = text.toLowerCase().indexOf(needle)
      if (index === -1) continue
      const start = Math.max(0, index - 25)
      const end = Math.min(text.length, index + needle.length + 40)
      const preview = text.slice(start, end).replace(/\n/g, ' ').trim()
      results.push({ entryId: entry.id, preview })
    }
    return results
  }

  /** Scroll the transcript so the entry lands near the top of the viewport. */
  private jumpToEntry(entryId: string): void {
    const index = this.entryOrder.indexOf(entryId)
    if (index === -1) return
    const width = this.terminal?.columns ?? 100
    let offset = 0
    for (let i = 0; i < index; i++) {
      const view = this.entryViews.get(this.entryOrder[i])
      if (view !== undefined) offset += view.render(width).length
    }
    this.scrollView?.scrollTo(Math.max(0, offset))
    // Focus the entry too when it is keyboard-reachable.
    const items = this.focusableItems
    const view = this.entryViews.get(entryId)
    if (view !== undefined && (view instanceof FocusableToolCard || view instanceof CollapsibleMessage || view instanceof FocusableFrame)) {
      const itemIndex = items.indexOf(view)
      if (itemIndex !== -1) this.setFocusIndex(itemIndex)
    }
    this.tui?.requestRender()
  }

  /** Load the persisted composer history into the editor (Up/Down recall). */
  private loadHistory(editor: Editor): void {
    if (this.historyFile === undefined) return
    try {
      const raw = readFileSync(this.historyFile, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        this.history = parsed.filter((line): line is string => typeof line === 'string').slice(-200)
        for (const line of this.history) editor.addToHistory(line)
      }
    } catch {
      // First run or a corrupt file: start empty, never block the surface.
    }
  }

  /** Append one submitted line and persist the bounded history (P2 2.4). */
  private persistHistory(text: string): void {
    if (this.historyFile === undefined) return
    const previous = this.history[this.history.length - 1]
    if (text !== previous) this.history.push(text)
    if (this.history.length > 200) this.history = this.history.slice(-200)
    try {
      mkdirSync(dirname(this.historyFile), { recursive: true })
      writeFileSync(this.historyFile, JSON.stringify(this.history, null, 2) + '\n')
    } catch {
      // A read-only home must not break the surface.
    }
  }

  /** Execute a `!command` and report its combined output (T5①). */
  private runShell(command: string, hidden: boolean): void {
    const trimmed = command.trim()
    if (trimmed === '') return
    let output = ''
    let errorText = ''
    const child = spawn(trimmed, { shell: true, timeout: 30_000 })
    child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { errorText += chunk.toString() })
    child.on('error', (error: Error) => { errorText += error.message })
    child.on('close', () => {
      const body = [output.trimEnd(), errorText.trimEnd()].filter(part => part !== '').join('\n')
      this.handlers?.onShellResult(`$ ${trimmed}\n${body === '' ? '(无输出)' : body}`, hidden)
    })
  }

  /** Confirm an oversized multi-line submission before routing it. */
  private async confirmBigPaste(text: string, accept: (text: string) => void): Promise<void> {
    const lines = text.split('\n').length
    const answer = await this.askDialog({
      title: `发送 ${lines} 行的大段内容？`,
      detail: '大段粘贴通常是意外；发送会作为一条消息进入会话。',
      options: ['发送', '取消'],
    })
    if (answer.reason === 'picked' && answer.picked === '发送') accept(text)
  }

  /** Current composer text (test/debug hook). */
  get composerText(): string {
    return this.editor?.getText() ?? ''
  }

  /** Ctrl+X: copy the latest assistant reply to the clipboard via OSC 52 (T5⑤). */
  private copyLastReply(): void {
    const last = [...this.current.entries].reverse().find(entry => entry.kind === 'assistant' && entry.text !== '')
    if (last === undefined || last.kind !== 'assistant') return
    this.copyText(last.text)
  }

  /** Copy plain text to the host clipboard via OSC 52 (best effort, K2). */
  copyText(text: string): void {
    if (this.terminal === undefined || text === '') return
    const payload = Buffer.from(text, 'utf8').toString('base64')
    this.terminal.write(`\x1b]52;c;${payload}\x07`)
    this.toast(strings().copied, 'success')
  }

  /**
   * Suspend the TUI and open `path` in $EDITOR (K2: /config 的编辑器入口).
   * The alt screen leaves, the app's raw-input listener detaches so the
   * editor owns every keystroke (Ctrl+C reaches the editor, not quit), and
   * on exit the surface re-enters, re-attaches keys, and repaints.
   */
  async openExternalEditor(path: string): Promise<void> {
    const tui = this.tui
    if (tui === undefined) return
    const editor = process.env.VISUAL !== undefined && process.env.VISUAL !== ''
      ? process.env.VISUAL
      : process.env.EDITOR
    if (editor === undefined || editor === '') {
      this.toast(strings().editorUnset, 'error')
      return
    }
    this.removeInputListener?.()
    this.removeInputListener = undefined
    tui.stop()
    await new Promise<void>((resolve) => {
      const child = spawn(`${editor} "${path.replaceAll('"', '\\"')}"`, { stdio: 'inherit', shell: true })
      child.on('error', () => resolve())
      child.on('close', () => resolve())
    })
    tui.start()
    this.attachInputListener(tui)
    const focus = this.editor
    if (focus !== undefined) tui.setFocus(focus)
    this.applyState(this.current)
    tui.requestRender()
  }

  /** The document entry id holding focus, or null (T3④ feedback target). */
  focusedEntryId(): string | null {
    if (this.focusIndex < 0) return null
    const focused = this.focusableItems[this.focusIndex]
    for (const key of this.entryOrder) {
      if (this.entryViews.get(key) === focused) return key
    }
    return null
  }

  /** Width for overlays: fit the terminal with a 72-column ceiling (T7). */
  private get overlayWidth(): number {
    return Math.max(24, Math.min(72, (this.terminal?.columns ?? 80) - 4))
  }

  async askDialog(question: ApprovalQuestion): Promise<ApprovalAnswer> {
    if (this.tui === undefined) return { reason: 'cancelled' }
    this.overlayOpen = true
    try {
      return await presentApprovalDialog(this.tui, question, undefined, 120_000, this.overlayWidth, question.icon ?? '？')
    } finally {
      this.overlayOpen = false
    }
  }
}
