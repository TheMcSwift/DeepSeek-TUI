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
  TuiMainScreen,
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
import { emptyDocument, transcriptText } from '../document/document.ts'
import { AtFileAutocompleteProvider, resolveAtPath } from './at-file-autocomplete.ts'
import type { AssistantEntry, DecodeSample, TurnOutcome, ViewDocument, ViewEntry } from '../document/document.ts'
import { CHARS_PER_TOKEN, gaugeGlyph, liveGauge, sparkline, statsStrip } from '../projection/stats.ts'
import { BrandView, shouldShowBrand, BRAND, ICE, gradientText } from '../view/brand.ts'
import type { CommandChoice, ModelChoice, PermissionChoice, PluginsRow, ProjectionRow, SessionChoice, SettingsRow, SurfaceMeta, TerminalApp, TerminalAppHandlers, TrajectoryRow } from './terminal-app.ts'
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
import { SlashMenu, SLASH_MENU_ROWS } from '../view/components/slash-menu.ts'
import type { SlashMenuItem, SlashMenuStyle } from '../view/components/slash-menu.ts'
import { HotkeysPanel } from '../view/components/hotkeys-panel.ts'
import { TipsPanel } from '../view/components/tips-panel.ts'
import { PluginsPanel } from '../view/components/plugins-panel.ts'
import { SettingsPanel } from '../view/components/settings-panel.ts'
import { TrajectoryPanel } from '../view/components/trajectory-panel.ts'
import { matchCommands, permissionDisplayName, permissionTone } from './pi/command-match.ts'
import { isKeymapId, isLeaderKey, keymapById, resolveKeyAction, resolveLeaderChord } from './pi/keymaps.ts'
import type { KeyAction, KeymapId } from './pi/keymaps.ts'
import type { OverlayHandle } from '@earendil-works/pi-tui'
import { ApprovalEntryView, presentApprovalDialog } from '../view/components/approval-view.ts'
import type { ApprovalAnswer, ApprovalQuestion } from '../view/components/approval-view.ts'
import { fg, bold, italic } from './pi/color.ts'
import { strings } from '../view/strings.ts'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
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

/**
 * regular 模式的转录容器（增量追加，DESIGN.md regular 备忘「待做」项）：
 * 缓存每个子组件（条目视图/brand splash/BottomPad）在给定宽度下的渲染行，
 * 条目更新时由 applyState 显式失效——流式 chunk 到达时只有变化条目重渲染，
 * TuiMainScreen 每帧只做「拼缓存行 + 差分写屏」，长会话渲染成本从
 * O(全会话 × 每条目重渲染) 降到 O(缓存拼接)。
 */
class CachedTranscript implements Component {
  private readonly rows = new Map<Component, { width: number; lines: string[] }>()
  private readonly order: Component[] = []
  private lastWidth = -1
  private joined: string[] = []
  private dirty = true

  invalidate(): void {
    this.dirty = true
  }

  /** 视图状态变化（applyState 的 updateEntryView 后）→ 失效该条目行缓存。 */
  invalidateEntry(component: Component): void {
    this.rows.delete(component)
    this.dirty = true
  }

  addChild(component: Component): void {
    this.order.push(component)
    this.dirty = true
  }

  removeChild(component: Component): void {
    const index = this.order.indexOf(component)
    if (index >= 0) this.order.splice(index, 1)
    this.rows.delete(component)
    this.dirty = true
  }

  render(width: number): string[] {
    if (width === this.lastWidth && !this.dirty) return this.joined
    this.lastWidth = width
    this.dirty = false
    const parts: string[][] = []
    for (const child of this.order) {
      let hit = this.rows.get(child)
      if (hit === undefined || hit.width !== width) {
        const lines = child.render(width)
        hit = { width, lines }
        this.rows.set(child, hit)
      }
      parts.push(hit.lines)
    }
    this.joined = parts.flat()
    return this.joined
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
      // cc 预设对齐 Claude Code 的星芒 spinner（`· ✢ ✳ ✶ ✻ ✽`，见 how-claude-code-works
      // 的 SpinnerGlyph 逆向分析）；pi Loader 支持自定义帧。
      { frames: ['·', '✢', '✳', '✶', '✻', '✽'], intervalMs: 80 },
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
  createTui: (terminal: Terminal, mouse?: boolean, regular?: boolean) => TUI
  /** Shimmer frame cadence in ms; 0 disables the brand + status animations. */
  animFrameMs: number
} = {
  createTerminal: () => new ProcessTerminal(),
  // The hardware cursor follows the composer/input caret, so IME candidate
  // windows anchor at the caret instead of the start of the input block.
  // Mouse capture is OFF by default (2026-08-20, 用户决策「右键默认归 Warp」):
  // SGR mouse reporting is only enabled when the app passes `mouse: true`
  // (PiTuiAppOptions.mouse or `DSH_TUI_MOUSE=1`). While reporting is off,
  // right-click and wheel belong to the host terminal (Warp's native menu /
  // scrollback); with it on, in-TUI wheel scrolling (slash-menu wheel routing
  // included) and the pi-native drag selection (B8) work. Expansion toggles
  // stay keyboard-only (pi-style) either way.
  // (TuiMainScreen has no layout engine, so the alt-screen renderer
  // is the only mode this surface can use — see DESIGN.md §10.)
  createTui: (terminal: Terminal, mouse?: boolean, regular?: boolean) =>
    regular === true
      ? new TuiMainScreen(terminal, true, undefined)
      : new TuiAltScreen(terminal, true, undefined, { mouse: mouse ?? process.env.DSH_TUI_MOUSE === '1' }),
  // The DeepSeek brand/status shimmer repaints ~57 frames over 3.4s; opt
  // out for constrained terminals/tests with DSH_TUI_ANIM=0.
  animFrameMs: process.env.DSH_TUI_ANIM === '0' ? 0 : 60,
}

/** Paste-size gate: more lines than this asks for confirmation. */
const BIG_PASTE_LINES = 30
/** Ctrl+K fold: entries kept visible below the fold banner. */
const FOLD_KEEP = 30

/**
 * 子序列匹配打分与权限分色已拆到 src/app/pi/command-match.ts（CC-01/03），
 * 此处保留模块级引用。
 */

/** B17: 排队消息预览——最多展示 3 条、各自折叠空白并截断（busy 状态行）。
 *  未领取区（远程的 steer/follow-up 区）在终端状态行里的等价呈现。 */
function queuePreview(messages: readonly string[]): string {
  const flat = (text: string): string => {
    const one = text.replace(/\s+/g, ' ').trim()
    return one.length > 24 ? `${one.slice(0, 23)}…` : one
  }
  const body = messages.slice(0, 3).map(flat).filter(text => text !== '').join(' · ')
  if (body === '') return '…'
  return messages.length > 3 ? `${body} …` : body
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
  entry: { turn?: number; stats?: { runMs: number; ttftMs: number; tokensPerSecond?: number }; usage?: { inputTokens: number; outputTokens: number }; outcome?: TurnOutcome; decodeSamples?: DecodeSample[] },
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
  // C1: post-turn decode sparkline (min-max over the last 12 samples).
  const spark = sparkline(entry.decodeSamples)
  if (spark !== undefined) parts.push(spark)
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

/**
 * 助手消息页脚：统计 + 时钟，流式且尚无正文但有 thinking 时挂思考脉冲
 * （CC-06，Claude Code 的 ⏺ ● ○ ○ 提示流式思考仍在进行的终端等价；静态
 * 标记即可，不新增定时器——busy 状态槽的 Loader 已在驱动重绘）。
 */
function assistantFooter(entry: AssistantEntry, doc: ViewDocument): string | undefined {
  const stats = statsFooter(entry, doc)
  const clock = clockFooter(entry.at)
  const base = stats === undefined ? clock : `${stats} · ${clock ?? ''}`.trimEnd()
  const pulse = entry.state === 'streaming' && entry.text.trim() === '' && entry.thinking.length > 0
    ? fg('thinkingText')('⏺ ● ○ ○')
    : ''
  return [base ?? '', pulse].filter(part => part !== '').join(' · ')
}

/** The last assistant entry when the doc is mid-decode (C1/V5 consumers). */
function streamingEntry(doc: ViewDocument): Extract<ViewEntry, { kind: 'assistant' }> | undefined {
  for (let i = doc.entries.length - 1; i >= 0; i -= 1) {
    const entry = doc.entries[i]
    if (entry.kind !== 'assistant') continue
    return entry.state === 'streaming' ? entry : undefined
  }
  return undefined
}

/** C1 live gauge text for the busy slot: `▰▰▰▱▱▱▱▱ 45 tok/s`, tone-coded
 *  (≥50 success / ≥20 warning / <20 error); omitted while unstable/short. */
function liveGaugeText(doc: ViewDocument): string | undefined {
  const streaming = streamingEntry(doc)
  if (streaming === undefined) return undefined
  const gauge = liveGauge(streaming.decodeSamples)
  if (gauge === undefined) return undefined
  const tone = gauge.tps >= 50 ? 'success' : gauge.tps >= 20 ? 'warning' : 'error'
  return ` · ${fg(tone)(gaugeGlyph(gauge.bars))} ${gauge.tps} tok/s`
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
  /** 快捷键预设（cc/pi）；缺省取 DSH_TUI_KEYMAP env，再缺省 cc。 */
  keymap?: KeymapId
  /** 开启 SGR 鼠标上报（TUI 内滚轮/选区复制）；缺省取 DSH_TUI_MOUSE=1，
   *  再缺省关闭（右键/滚轮归宿主终端，2026-08-20 用户决策）。 */
  mouse?: boolean
  /** regular 模式（TuiMainScreen 主屏渲染，输出留在 scrollback；无布局引擎/
   *  应用滚动/鼠标，见 DESIGN.md regular 备忘）。**默认开启（2026-08-20 用户决策）**；
   *  fullscreen 显式关闭。 */
  regular?: boolean
  /** fullscreen 视口模式（TuiAltScreen，旧的默认）；与 regular 互斥，优先于 regular。 */
  fullscreen?: boolean
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
  private document?: Component & { addChild(component: Component): void; removeChild(component: Component): void }
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
  /** 排队消息内容（队首预览显示在 busy 状态行）。 */
  private queueMessages: string[] = []
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
  /** Jobs collapsed to one row while more than one runs (P3, Ctrl+O). */
  private jobsExpanded = false
  /** Transient status-slot toast timer + pending styled text (P2). */
  private toastTimer?: ReturnType<typeof setTimeout>
  private pendingToast?: string
  /** 500ms idle ticker: live job clocks (E8) + the ↓ End hint (F2). */
  private idleTick?: ReturnType<typeof setInterval>
  private lastFollowingEnd = true
  /** B14: 当前回合的 cc 预设 busy 动词（每回合重置；空 = 用 web 文案）。 */
  /** B16: NewMessagesPill——离开底部时的条目数基线（undefined = 未离开过）。 */
  private offBottomBaseline: number | undefined
  private newMessages = 0
  /** Busy flag of the previous render (elapsed-time anchor). */
  private wasBusy = false
  /** 当前快捷键预设（cc/pi/opencode），/keymap 与 DSH_TUI_KEYMAP 切换。 */
  private keymap: KeymapId = 'cc'
  /** SGR 鼠标上报开关（默认关：右键/滚轮归宿主终端；开启后 TUI 内选区/滚轮可用）。 */
  private readonly mouse: boolean
  /** regular 模式（TuiMainScreen 主屏渲染；默认开启，--fullscreen 切回视口）。 */
  private readonly regular: boolean
  /** opencode leader 键等待态（Ctrl+X 前缀 + 2s 超时）。 */
  private pendingLeader = false
  private leaderTimer?: ReturnType<typeof setTimeout>
  /** cc 预设双按退出：空输入首次 Ctrl+C/Ctrl+D 进入 3s 待命，再按才退出。 */
  private exitArmed = false
  private exitArmTimer?: ReturnType<typeof setTimeout>
  /** B7: 空输入双击 Esc 的时间回溯待命（400ms 窗口内第二次 Esc 触发 /rewind）。 */
  private rewindArmed = false
  private rewindTimer?: ReturnType<typeof setTimeout>
  /** /settings 面板实例（打开期间就地刷新行）。 */
  private settingsPanel?: SettingsPanel

  constructor(options: PiTuiAppOptions = {}) {
    this.historyFile = options.historyFile
    this.keymap = options.keymap ?? (isKeymapId(process.env.DSH_TUI_KEYMAP ?? '') ? process.env.DSH_TUI_KEYMAP as KeymapId : 'cc')
    // 鼠标上报默认关闭（右键/滚轮归宿主终端）；DSH_TUI_MOUSE=1 或选项显式开启。
    this.mouse = options.mouse ?? process.env.DSH_TUI_MOUSE === '1'
    // 渲染模式（2026-08-20 用户决策：regular 为默认）：
    // options.regular 显式优先；fullscreen（选项或 DSH_TUI_FULLSCREEN=1）显式
    // 切回 alt-screen 视口；DSH_TUI_REGULAR=1 显式 regular；缺省 regular。
    const envFullscreen = process.env.DSH_TUI_FULLSCREEN === '1'
    const envRegular = process.env.DSH_TUI_REGULAR === '1'
    this.regular = options.regular ?? (options.fullscreen === true || envFullscreen ? false : envRegular || true)
  }

  start(handlers: TerminalAppHandlers, meta: SurfaceMeta): void {
    this.handlers = handlers
    this.meta = meta
    const terminal = piTuiInternals.createTerminal()
    this.terminal = terminal
    const tui: TUI = piTuiInternals.createTui(terminal, this.mouse, this.regular)
    this.tui = tui
    if (tui instanceof TuiAltScreen) this.altScreen = tui
    else this.altScreen = undefined
    if (isViewportTUI(tui)) this.hookAltScreen()

    this.header = new Text('', 0, 0)
    // regular 模式用行缓存转录容器（增量追加）；alt-screen 保持 Container。
    this.document = this.regular ? new CachedTranscript() : new Container()
    // The pad pushes short transcripts to the bottom (chat-style anchoring).
    this.document.addChild(this.bottomPad)
    // The DeepSeek brand splash sits above the transcript while the session
    // is still empty (renders zero rows once the conversation starts).
    this.document.addChild(this.brandView)
    // The transcript absorbs all remaining height; everything else keeps its
    // intrinsic size, so the composer is pinned to the bottom of the frame.
    // regular 模式无 ScrollView（转录直接渲染进主屏 scrollback）。
    if (isViewportTUI(tui)) {
      this.scrollView = new ScrollView(this.document, {
        follow: 'end',
        primary: true,
        scrollbar: 'auto',
        scrollbarStyle: (text: string) => fg('scrollbarThumb')(text),
      })
    }
    const statusSlot = new StatusSlot(tui)
    this.statusSlot = statusSlot

    const editor = new Editor(tui, getEditorTheme())
    // @/# 补全弹层打开时按 Enter 会应用补全并吞掉提交（pi 编辑器内部行为：
    // 仅 slash 前缀落回 submit，@/# 前缀直接 return）。包装 handleInput——
    // Enter 前先收起弹层再走原路径，Enter 保持「发送正文」语义；Tab 补全
    // 与 ↑/↓ 选择不受影响。与 hookAltScreen 同一实例级 hook 纪律（结构
    // 读取运行时私有字段，不改 node_modules）。
    const rawEditorInput = editor.handleInput.bind(editor)
    editor.handleInput = (data: string) => {
      const autocomplete = (editor as unknown as { autocompleteState?: unknown }).autocompleteState
      if (autocomplete !== undefined && autocomplete !== null && matchesKey(data, 'enter')) {
        (editor as unknown as { cancelAutocomplete?: () => void }).cancelAutocomplete?.()
      }
      rawEditorInput(data)
    }
    this.loadHistory(editor)
    const submit = (text: string): void => {
      if (text === '/quit') handlers.onQuit()
      else if (text === '/new') handlers.onNewSessionRequest?.()
      else if (text === '') return
      // busy Enter 语义（B1，BACKLOG-CC-PARITY）：cc 预设默认 steer（CC 语义），
      // pi/opencode 预设默认 queue（web 语义）；DSH_TUI_ENTER 或 /settings 显式
      // 设置（steer/queue）覆盖预设默认。
      else if (this.current.busy && this.busyEnterIsSteer()) handlers.onSteerRequest?.(text)
      else handlers.onInput(text)
    }
    const accept = (text: string): void => {
      editor.addToHistory(text)
      // B9: 发送前展开 @ 引用——文本文件内容/目录列表自动附加（命令/! 行不经过这里）。
      submit(this.expandAtReferences(text))
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
    // B9: @ 引用补全走自研扫描（basename 匹配、@"path" 引号），# 路径补全仍由 pi 提供。
    editor.setAutocompleteProvider(new AtFileAutocompleteProvider(
      new CombinedAutocompleteProvider([], this.meta.workspace ?? process.cwd()),
      this.meta.workspace ?? process.cwd(),
    ))
    editor.onChange = (text: string) => {
      this.updateSlashMenu(text)
    }
    this.editor = editor
    // Web-parity editor keys: Ctrl+Z undo / Ctrl+Shift+Z redo. pi defaults to
    // Ctrl+- / Alt+Y, and Ctrl+Y stays our rate key.
    getKeybindings().setUserBindings({ 'tui.editor.undo': 'ctrl+z', 'tui.editor.yankPop': 'ctrl+shift+z' })

    if (isViewportTUI(tui)) {
      // alt-screen（默认）：布局引擎 + ScrollView 滚动（见 DESIGN.md）。
      const layout = new VStack([
        this.header,
        new DynamicBorder((text: string) => fg('borderAccent')(text)),
        this.capabilityPanel,
        { component: this.scrollView!, basis: 0, grow: 1, shrink: 1, minSize: 1 },
        statusSlot,
        new DynamicBorder((text: string) => fg('borderMuted')(text)),
        this.footerLine,
        editor,
      ])
      tui.setLayoutRoot(layout)
    } else {
      // regular 模式（TuiMainScreen，--regular / DSH_TUI_REGULAR=1）：主屏渲染，
      // 无布局引擎——组件按文档流顺序堆叠（TuiBase.render 逐 child 拼行），
      // 转录不经过 ScrollView（直接是 document），底部由 BottomPad 手动钉底。
      // 能力降级：无应用滚动（isFollowingEnd 恒 true → 回底提示/B16 计数不出现）、
      // 无鼠标（归终端原生）、Ctrl+F 跳转不可用（startSearch 守卫）。
      this.scrollView = undefined
      tui.addChild(this.header)
      tui.addChild(new DynamicBorder((text: string) => fg('borderAccent')(text)))
      tui.addChild(this.capabilityPanel)
      tui.addChild(this.document) // 转录（含 brand splash 与 BottomPad）
      tui.addChild(statusSlot)
      tui.addChild(new DynamicBorder((text: string) => fg('borderMuted')(text)))
      tui.addChild(this.footerLine)
      tui.addChild(editor)
    }

    this.attachInputListener(tui)

    tui.start()
    tui.setFocus(editor)
    this.applyState(this.current)
    tui.requestRender()
  }

  /** The app's global key handling (raw input no focused view consumed). */
  private handleGlobalKey(data: string): { consume: boolean } | undefined {
    // 每个键击上报：runner 据此暂停启动期标题回填（按键渲染优先）。
    this.handlers?.onUserActivity?.()
    if (this.handleSlashMenuKey(data)) return { consume: true }
    // 菜单打开时 Enter 直接执行当前选中项（上游语义：↑/↓ 选中即执行，
    // 无需先 Tab 补全——编辑器里的 `/xxx` 只是过滤串，未补全时提交它
    // 会解析成空命令而静默失效）。skill 项照常走 onCommandPicked 的插入语义。
    if (matchesKey(data, 'enter') && this.slashMenuOpen) {
      const token = /^\/(\S*)$/.exec(this.editor?.getText() ?? '')?.[1]?.toLowerCase() ?? ''
      const picked = this.matchingCommands(token)[this.slashMenuIndex]
      if (picked !== undefined) {
        this.closeSlashMenu()
        this.editor?.setText('')
        this.handlers?.onCommandPicked(picked.value, '')
        this.tui?.requestRender()
        return { consume: true }
      }
    }
    // 通用交互不进预设：Tab 焦点环与 Esc 焦点复位。
    // 导出转录到终端 scrollback（Claude Code fullscreen 的 `[` 语义）：仅输入框
    // 为空时响应，避免与普通打字冲突。
    if (data === '[' && !this.overlayOpen && (this.editor?.getText() ?? '') === '') {
      this.exportTranscriptToScrollback()
      return { consume: true }
    }
    // cc 预设的 CC 语义例外（B4）：busy 且输入非空时 Tab = follow-up（排入当前
    // 回合之后），输入为空仍走焦点环。
    if (matchesKey(data, 'tab') && !this.overlayOpen) {
      if (this.keymap === 'cc' && this.current.busy && (this.editor?.getText() ?? '').trim() !== '') {
        const text = this.editor?.getText() ?? ''
        this.editor?.setText('')
        this.handlers?.onInput(text)
        this.toast(strings().queuedFollowUp, 'info')
        this.tui?.requestRender()
        return { consume: true }
      }
      if (this.focusableItems.length > 0) {
        this.cycleFocus()
        return { consume: true }
      }
    }
    if (matchesKey(data, 'escape') && !this.overlayOpen && this.focusIndex >= 0) {
      this.setFocusIndex(-1)
      return { consume: true }
    }
    // B6/B7（BACKLOG-CC-PARITY）：cc 预设 idle Esc 层级——菜单/补全的 Esc 已被
    // 上层消费，落到这里的有输入先清空（CC 语义）；空输入双击 Esc = 时间回溯
    // rewind（400ms 窗口）。busy Esc 由 keymap 的 interrupt 处理。
    if (matchesKey(data, 'escape') && !this.overlayOpen && this.keymap === 'cc' && !this.current.busy) {
      const text = this.editor?.getText() ?? ''
      if (text !== '') {
        this.disarmExit()
        this.disarmRewind()
        this.editor?.setText('')
        this.tui?.requestRender()
        return { consume: true }
      }
      if (this.rewindArmed) {
        this.disarmRewind()
        this.handlers?.onRewindRequest?.()
        return { consume: true }
      }
      this.rewindArmed = true
      this.clearRewindTimer()
      this.rewindTimer = setTimeout(() => { this.rewindArmed = false }, PiTuiApp.REWIND_ARM_MS)
      return { consume: true }
    }
    const preset = keymapById(this.keymap)
    // leader 和弦（opencode：Ctrl+X 前缀 + 2s 超时）：已按下 leader 则解析
    // 下一键；未命中吞掉。
    if (this.pendingLeader) {
      this.clearLeaderPending()
      const chord = resolveLeaderChord(preset, data, this.current.busy)
      return chord === undefined ? { consume: true } : this.runAction(chord)
    }
    if (isLeaderKey(preset, data)) {
      this.armLeaderPending()
      return { consume: true }
    }
    // 普通按键：经当前预设解析动作（cc/pi/opencode，见 app/pi/keymaps.ts）。
    const action = resolveKeyAction(preset, data, this.current.busy)
    return action === undefined ? undefined : this.runAction(action)
  }

  /** 当前按键预设下的 busy Enter 语义（B1）：显式设置覆盖，否则按预设默认。
   *  cc 预设 = steer（Claude Code），pi/opencode 预设 = queue（web）。 */
  private busyEnterIsSteer(): boolean {
    const saved = process.env.DSH_TUI_ENTER
    if (saved === 'steer') return true
    if (saved === 'queue') return false
    return this.keymap === 'cc'
  }

  /** 执行一个全局键动作（预设解析后的公共分发点）。 */
  private runAction(action: KeyAction): { consume: boolean } | undefined {
    switch (action) {
      case 'interrupt':
        this.handlers?.onInterrupt()
        return { consume: true }
      case 'interruptSend':
        // B5: Ctrl+Enter = 打断当前回合并立即投递输入（CC 三态投递）；空输入退化为纯中断。
        if (this.overlayOpen || this.focusIndex >= 0) return undefined
        {
          const text = this.editor?.getText() ?? ''
          if (text.trim() === '') {
            this.handlers?.onInterrupt()
          } else {
            this.editor?.setText('')
            this.handlers?.onInterruptSend?.(this.expandAtReferences(text))
          }
          this.tui?.requestRender()
          return { consume: true }
        }
      case 'cycleMode':
        // B8: Shift+Tab 循环会话模式（默认 → 计划 → 完全访问）。
        if (this.overlayOpen) return undefined
        this.handlers?.onCycleModeRequest?.()
        return { consume: true }
      case 'quit':
      case 'quitCtrlD':
        // B3/B20: cc 预设下 idle Ctrl+C/Ctrl+D 是 CC 语义双按退出（有输入先清空）；
        // 其他预设保持单次退出（pi/opencode 各自的肌肉记忆）。
        if (this.keymap === 'cc') {
          this.handleCcDoubleExit()
          return { consume: true }
        }
        this.handlers?.onQuit()
        return { consume: true }
      case 'clearInput':
        // opencode input_clear：busy Ctrl+C 清空输入而非中断。
        this.editor?.setText('')
        this.tui?.requestRender()
        return { consume: true }
      case 'sessions':
        this.handlers?.onSessionPickerRequest?.()
        return { consume: true }
      case 'newSession':
        this.handlers?.onNewSessionRequest?.()
        return { consume: true }
      case 'rename':
        this.handlers?.onCommandPicked('__rename', '')
        return { consume: true }
      case 'model':
        this.handlers?.onModelPickerRequest?.()
        return { consume: true }
      case 'permission':
        this.handlers?.onPermissionPickerRequest?.()
        return { consume: true }
      case 'theme':
        this.handlers?.onThemePickerRequest?.()
        return { consume: true }
      case 'compose':
        void this.composeInEditor()
        return { consume: true }
      case 'editInput':
        // B18: cc 预设 Ctrl+X——用 $EDITOR 编辑当前输入，保存退出回填（CC 复刻）。
        void this.editInputInEditor()
        return { consume: true }
      case 'export':
        this.handlers?.onCommandPicked('__export', '')
        return { consume: true }
      case 'compact':
        this.handlers?.onCommandPicked('compact', '')
        return { consume: true }
      case 'palette':
        this.handlers?.onCommandPickerRequest?.()
        return { consume: true }
      case 'exitPlan':
        if (this.current.planMode === true) this.handlers?.onExitPlanModeRequest?.()
        return this.current.planMode === true ? { consume: true } : undefined
      case 'workspace':
        this.handlers?.onWorkspaceSwitchRequest?.()
        return { consume: true }
      case 'search':
        void this.startSearch()
        return { consume: true }
      case 'fork':
        this.handlers?.onForkPickerRequest?.()
        return { consume: true }
      case 'rate':
        this.handlers?.onRateRequest?.()
        return { consume: true }
      case 'copy':
        this.copyLastReply()
        return { consume: true }
      case 'steer':
        if (!this.overlayOpen && this.focusIndex === -1) {
          const text = this.editor?.getText() ?? ''
          if (text.trim() !== '') {
            this.editor?.setText('')
            this.handlers?.onSteerRequest?.(text)
          }
          return { consume: true }
        }
        return undefined
      case 'retrieve':
        if (!this.overlayOpen && this.focusIndex === -1) {
          this.handlers?.onQueueRetrieveRequest?.()
          return { consume: true }
        }
        return undefined
      case 'historySearch':
        // B5: Alt+R 输入历史搜索——最近的输入先列，选中回填输入框。
        if (!this.overlayOpen && this.focusIndex === -1) {
          this.showHistorySearch()
          return { consume: true }
        }
        return undefined
      case 'jobs':
        // Ctrl+O toggles the collapsed job row (Ctrl+J's byte \x0a is a newline
        // character the editor needs for multi-line paste, so it can't be a key).
        if (!this.overlayOpen) this.toggleJobsExpanded()
        return this.overlayOpen ? undefined : { consume: true }
      case 'trajectory':
        // Ctrl+L（Log）：Ctrl+I 与 Tab 同字节不可分，故用 L。
        this.handlers?.onTrajectoryRequest?.()
        return { consume: true }
      case 'fold': {
        const visible = this.current.entries.filter(isRenderedEntry)
        if (visible.length > FOLD_KEEP) {
          this.viewFolded = !this.viewFolded
          this.applyState(this.current)
        }
        return { consume: true }
      }
      case 'thinking':
        this.hideThinking = !this.hideThinking
        for (const view of this.entryViews.values()) {
          const inner = view instanceof FocusableFrame ? view.inner : view
          if (inner instanceof AssistantMessageComponent) inner.setHideThinkingBlock(this.hideThinking)
        }
        this.tui?.requestRender()
        return { consume: true }
      default:
        return undefined
    }
  }

  /**
   * 导出转录到终端 scrollback（Claude Code fullscreen 的 `[` 语义）：退出
   * alternate screen → 把转录写入主屏缓冲（内容进入终端原生 scrollback，
   * Cmd+F/tmux copy-mode 可搜索）→ 重新进入 alt screen 并重绘。
   */
  private exportTranscriptToScrollback(): void {
    const text = transcriptText(this.current)
    if (text === '') {
      this.toast(strings().transcriptEmpty, 'info')
      return
    }
    const terminal = this.terminal
    if (terminal === undefined) return
    terminal.write('\x1b[?1049l') // 退出 alt screen（EXIT_ALT_SCREEN）
    terminal.write(`\n${text}\n`)
    terminal.write('\x1b[?1049h') // 重进 alt screen（ENTER_ALT_SCREEN）
    this.tui?.requestRender()
    this.toast(strings().transcriptToScrollback, 'success')
  }

  /** cc 预设双按退出的 3s 待命窗口。 */
  private static readonly EXIT_ARM_MS = 3000
  /** B7: 空输入双击 Esc 的时间回溯窗口。 */
  private static readonly REWIND_ARM_MS = 400
  /** B9: @ 引用自动附加的单个文件大小上限（64 KiB，超出保留原文）。 */
  private static readonly AT_ATTACH_MAX_BYTES = 64 * 1024

  /**
   * cc 预设的 CC 语义退出（B3/B20）：idle Ctrl+C/Ctrl+D——输入非空先清空输入
   * （并解除待命）；空输入第一次进入 3s 待命并提示「再按一次退出」，窗口内
   * 再按才真正退出。避免单次误触直接退出（此前 cc 单次 Ctrl+C 即退）。
   */
  private handleCcDoubleExit(): void {
    const text = this.editor?.getText() ?? ''
    if (text !== '') {
      this.disarmExit()
    this.disarmRewind()
      this.editor?.setText('')
      this.tui?.requestRender()
      return
    }
    if (this.exitArmed) {
      this.disarmExit()
    this.disarmRewind()
      this.handlers?.onQuit()
      return
    }
    this.exitArmed = true
    this.clearExitTimer()
    this.exitArmTimer = setTimeout(() => { this.exitArmed = false }, PiTuiApp.EXIT_ARM_MS)
    this.toast(strings().pressAgainToExit, 'info')
  }

  private disarmExit(): void {
    this.exitArmed = false
    this.clearExitTimer()
  }

  private clearExitTimer(): void {
    if (this.exitArmTimer !== undefined) {
      clearTimeout(this.exitArmTimer)
      this.exitArmTimer = undefined
    }
  }

  private disarmRewind(): void {
    this.rewindArmed = false
    this.clearRewindTimer()
  }

  private clearRewindTimer(): void {
    if (this.rewindTimer !== undefined) {
      clearTimeout(this.rewindTimer)
      this.rewindTimer = undefined
    }
  }

  /** 切换快捷键预设（/keymap）；热键面板与全局键立即随新预设解析。 */
  setKeymap(id: KeymapId): void {
    if (this.keymap === id) return
    const prev = this.keymap
    this.keymap = id
    this.clearLeaderPending()
    // cc ⇄ 其他预设：已结束条目的自动收起态随预设切换（cc 收、其他展开）。
    if ((prev === 'cc') !== (id === 'cc')) {
      for (const [key, view] of this.entryViews) {
        const entry = this.current.entries.find(item => item.id === key)
        const done = entry === undefined || !('state' in entry) || entry.state !== 'streaming'
        const inner = view instanceof FocusableFrame ? view.inner : view
        if (inner instanceof AssistantMessageComponent) {
          inner.setAutoCollapseThinking(id === 'cc' && done)
        } else if (view instanceof CollapsibleMessage) {
          const wrapped = view.getInner()
          if (wrapped instanceof AssistantMessageComponent) wrapped.setAutoCollapseThinking(id === 'cc' && done)
        } else if (view instanceof FocusableToolCard && (id === 'cc' ? done : view.isAutoCollapsed)) {
          // 切到 cc：已结束的收起；切走：恢复完整渲染。
          view.setAutoCollapsed(id === 'cc')
        }
      }
    }
    this.tui?.requestRender()
  }

  /** cc 预设启用 Claude Code 语式的「结束后自动收起」。 */
  private get ccAutoCollapse(): boolean {
    return this.keymap === 'cc'
  }

  /** 进入 leader 等待态（opencode：2s 超时）。 */
  private armLeaderPending(): void {
    this.pendingLeader = true
    this.clearLeaderTimer()
    this.leaderTimer = setTimeout(() => { this.pendingLeader = false }, 2000)
  }

  private clearLeaderPending(): void {
    this.pendingLeader = false
    this.clearLeaderTimer()
  }

  private clearLeaderTimer(): void {
    if (this.leaderTimer !== undefined) {
      clearTimeout(this.leaderTimer)
      this.leaderTimer = undefined
    }
  }

  /**
   * 换肤后重建视图（/theme、/preset）：markdown 主题与既有消息视图在构造期
   * 烘焙了 formatter，palette 切换后必须重建；composer 文本保留。已知限制：
   * 编辑器边框与 @/# 补全弹层在 pi-tui 里构造期烘焙主题、无 setter，保持
   * 换肤前的颜色直到重启（消息/工具/页脚/状态/面板全部即时生效）。
   */
  refreshTheme(): void {
    this.markdownTheme = getMarkdownTheme()
    const document = this.document
    if (document !== undefined) {
      for (const view of this.entryViews.values()) document.removeChild(view)
    }
    this.entryViews.clear()
    this.entryOrder = []
    this.lastEntry.clear()
    this.applyState(this.current)
    this.tui?.requestRender()
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
    this.disarmExit()
    this.disarmRewind()
    // Drop the previous session's view state before re-rendering the next.
    this.current = emptyDocument()
    this.wasBusy = false
    this.queueCount = 0
    this.queueMessages = []
    this.editor?.setText('')
    this.applyState(this.current)
  }

  stop(): void {
    this.removeInputListener?.()
    this.removeInputListener = undefined
    this.clearLeaderTimer()
    this.pendingLeader = false
    this.disarmExit()
    this.disarmRewind()
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
    }, () => {
      // 每次按键（含 ↑/↓）上报：runner 暂停空闲标题回填，导航优先。
      this.handlers?.onSessionPickerActivity?.()
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

  /** B7: 时间回溯选择器（/rewind 与空输入双击 Esc 共用入口）。 */
  showRewindPicker(items: readonly SessionChoice[]): void {
    this.showChoicePicker(strings().rewindPickerTitle, items.map(item => ({
      value: item.value,
      label: item.label,
      description: item.description,
    })), (value) => { this.handlers?.onRewindPicked?.(value === null ? null : Number(value)) })
  }

  /** Push the command catalog for the inline slash menu (cc/pi style). */
  setCommands(items: readonly CommandChoice[]): void {
    this.commandCatalog = [...items]
    if (this.slashMenuOpen) this.updateSlashMenu(this.editor?.getText() ?? '')
  }

  /** Catalog rows matching the current slash query (name, alias, or label). */
  private matchingCommands(query: string): CommandChoice[] {
    return matchCommands(this.commandCatalog, query)
  }

  /** Open/refresh the non-capturing slash menu above the composer. */
  private updateSlashMenu(text: string): void {
    const idiom = keymapById(this.keymap).interaction.slash
    // `panel` 语式：不弹内联菜单，命令只走 Ctrl+P 面板；Enter 提交的 `/xxx`
    // 行仍按目录解析执行。（opencode 用 popup 语式：弹层与面板并存。）
    if (idiom === 'panel') {
      this.closeSlashMenu()
      return
    }
    const token = /^\/(\S*)$/.exec(text)
    if (token === null || this.tui === undefined) {
      this.closeSlashMenu()
      return
    }
    const query = token[1].toLowerCase()
    // pi 语式（slash: 'compact'）：仅名称与提示；cc（spacious）与 opencode
    // （popup）含描述列。
    const compact = idiom === 'compact'
    const items: SlashMenuItem[] = this.matchingCommands(query)
      .map((item) => {
        // The display word comes from the label (`/new · 新会话` → `new`);
        // the internal value (e.g. `__new`) resolves on submit.
        const rest = item.label.startsWith('/') ? item.label.slice(1) : item.label
        const [name, ...tail] = rest.split(' ')
        return {
          name,
          // tail 里混了参数提示（`<provider/model>`）与中文显示名（`· 新会话`）。
          // 只有含 `<…>` 的才是 hint；中文显示名并入 description 对齐 Claude Code。
          ...tail.filter(part => part.includes('<')).length > 0 ? { hint: tail.filter(part => part.includes('<')).join(' ') } : {},
          ...compact ? {} : { description: item.description },
        }
      })
    if (!this.slashMenuOpen) {
      // 广义交互层：opencode 方角弹层，pi 圆角框（pi SelectList 视觉），cc 无边框行。
      const menuStyle: SlashMenuStyle = idiom === 'popup'
        ? 'popup'
        : keymapById(this.keymap).interaction.card === 'boxed' ? 'boxed' : 'plain'
      const menu = new SlashMenu(items, menuStyle)
      this.slashMenu = menu
      this.slashMenuOpen = true
      this.slashMenuIndex = 0
      // cc（plain）语式的菜单接近终端全宽（Claude Code `/` 补全的分列列表——
      // 描述列需要足够空间）；boxed/popup 保持弹层宽度（有边框的浮层语义）。
      const menuWidth = menuStyle === 'plain'
        ? Math.max(24, (this.terminal?.columns ?? 80) - 2)
        : this.overlayWidth - 8
      this.slashMenuHandle = this.tui.showOverlay(menu, {
        anchor: 'bottom-left', offsetY: -6, maxHeight: '40%', width: menuWidth,
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
    // ↑/↓ 在整表间循环（触底回首部，反之到尾部）；PgUp/PgDn 按窗口整页跳转。
    if (matchesKey(data, 'up')) {
      const items = this.slashMenuItemsCount()
      this.slashMenuIndex = this.slashMenuIndex === 0 ? items - 1 : this.slashMenuIndex - 1
      this.slashMenu.selectedIndex = this.slashMenuIndex
      this.tui?.requestRender()
      return true
    }
    if (matchesKey(data, 'down')) {
      const items = this.slashMenuItemsCount()
      this.slashMenuIndex = this.slashMenuIndex === items - 1 ? 0 : this.slashMenuIndex + 1
      this.slashMenu.selectedIndex = this.slashMenuIndex
      this.tui?.requestRender()
      return true
    }
    if (matchesKey(data, 'pageUp')) {
      this.slashMenuIndex = Math.max(0, this.slashMenuIndex - SLASH_MENU_ROWS)
      this.slashMenu.selectedIndex = this.slashMenuIndex
      this.tui?.requestRender()
      return true
    }
    if (matchesKey(data, 'pageDown')) {
      const items = this.slashMenuItemsCount()
      this.slashMenuIndex = Math.min(items - 1, this.slashMenuIndex + SLASH_MENU_ROWS)
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
      // 输入区不吃滚轮：滚轮落在编辑器行内时不滚动转录（pi 在光标下方没有
      // 滚动视图时会回退到主滚动视图，把输入框上的滚轮卷到转录上）。
      const editorLines = this.editor === undefined ? 1 : Math.max(1, this.editor.getText().split('\n').length)
      const rows = this.terminal?.rows ?? 0
      if (rows > 0 && event.y >= rows - editorLines) return
      routeWheel(event)
      this.syncBackToBottomHint()
    }
    // pi 在构造期第一个注册了 handleViewportInput 并 consume 掉 PgUp/End 等
    // 视口键——我们自己的输入监听器收不到这些键。包装它：滚动处理照旧，
    // 处理完同步 ↓ End 提示与 ticker 状态（F2）。
    const handleViewportInput = alt.handleViewportInput.bind(altScreen)
    alt.handleViewportInput = (data: string) => {
      // Home/End 在 pi 键表里同时是 altScreen.top/bottom（视口滚动）与
      // editor.cursorLineStart/End（光标行首行尾），而 alt-screen 的监听器
      // 先于编辑器消费——聚焦输入框时把 Home/End 转发给编辑器，行首/行尾
      // 才是正确语义（焦点环聚焦消息时仍保留视口滚动行为）。
      if (!this.overlayOpen && this.focusIndex === -1 && (matchesKey(data, 'home') || matchesKey(data, 'end'))) {
        this.editor?.handleInput(data)
        this.syncBackToBottomHint()
        this.syncIdleTicker()
        return { consume: true }
      }
      // 斜杠菜单打开时 PgUp/PgDn 翻菜单（与滚轮同一条拦截路径）：pi 的视口
      // 处理无条件 consume 这两个键，应用监听器收不到，必须在这里先截走。
      if (this.slashMenuOpen && (matchesKey(data, 'pageUp') || matchesKey(data, 'pageDown'))) {
        this.handleSlashMenuKey(data)
        return { consume: true }
      }
      // 覆盖层打开时 PgUp/PgDn 翻覆盖层（picker/settings/plugins/轨迹/热键/
      // 决策卡），而不是滚背后的转录——同样因视口处理先吞键而必须在此转发。
      if (this.overlayOpen && (matchesKey(data, 'pageUp') || matchesKey(data, 'pageDown'))) {
        const target = this.topmostOverlayWithInput()
        if (target !== undefined) {
          target.handleInput(data)
          this.tui?.requestRender()
          this.syncBackToBottomHint()
          this.syncIdleTicker()
          return { consume: true }
        }
      }
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

  /**
   * 顶层覆盖层里第一个带 handleInput 的组件（决策卡/选择器/面板/输入框）。
   * pi 的 overlayStack 是私有字段，这里结构性读取（与 altScreen 的
   * routeWheel/handleViewportInput 同一模式）；栈顶即最近打开的覆盖层。
   */
  private topmostOverlayWithInput(): { handleInput(data: string): void } | undefined {
    if (this.tui === undefined) return undefined
    const stack = (this.tui as unknown as { overlayStack?: Array<{ component: unknown }> }).overlayStack
    if (stack === undefined) return undefined
    for (let i = stack.length - 1; i >= 0; i--) {
      const component = stack[i]?.component
      if (component !== null && typeof component === 'object' && 'handleInput' in component) {
        return component as { handleInput(data: string): void }
      }
    }
    return undefined
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

  /** B5: Alt+R 历史搜索——最近的输入先列，选中条目回填输入框。 */
  showHistorySearch(): void {
    const rows = this.history.slice().reverse().map((line, index) => ({
      value: `h${index}`,
      label: line,
    }))
    if (rows.length === 0) {
      this.toast(strings().historyEmpty, 'info')
      return
    }
    this.showChoicePicker(strings().historyTitle, rows, (value) => {
      if (value === null || this.editor === undefined) return
      const picked = rows.find(row => row.value === value)
      if (picked !== undefined) this.editor.setText(picked.label)
    })
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
    // 面板内容随当前快捷键预设切换（cc/pi/opencode 三套键位说明）。
    const sections = this.keymap === 'pi'
      ? strings().hotkeysSectionsPi
      : this.keymap === 'opencode'
        ? strings().hotkeysSectionsOpencode
        : strings().hotkeysSections
    const panel = new HotkeysPanel(sections, () => {
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

  /** Open the /tips reference panel (grouped hint lines, A18). */
  showTips(): void {
    const tui = this.tui
    if (tui === undefined) return
    const panel = new TipsPanel(strings().tipGroups, () => {
      this.overlayOpen = false
      handle.hide()
    })
    this.overlayOpen = true
    const handle = tui.showOverlay(panel, {
      anchor: 'bottom-left', offsetY: -6, maxHeight: '50%', width: this.overlayWidth - 8,
    })
    tui.setFocus(panel)
  }

  /** Open the trajectory (Inspect) view over the raw event log (B11/H31). */
  showTrajectory(rows: readonly TrajectoryRow[]): void {
    const tui = this.tui
    if (tui === undefined) return
    const panel = new TrajectoryPanel(rows, () => {
      this.overlayOpen = false
      handle.hide()
    })
    this.overlayOpen = true
    const handle = tui.showOverlay(panel, {
      anchor: 'bottom-left', offsetY: -6, maxHeight: '60%', width: this.overlayWidth - 8,
    })
    tui.setFocus(panel)
  }

  /** /settings 聚合面板（M2）：打开或就地刷新行；纯语义色随主题预设换肤。 */
  showSettings(rows: readonly SettingsRow[]): void {
    const tui = this.tui
    if (tui === undefined) return
    if (this.settingsPanel !== undefined) {
      // 面板内切换主题/键位后：行数据就地刷新，颜色在下次渲染随新预设生效。
      this.settingsPanel.setRows(rows)
      tui.requestRender()
      return
    }
    const panel = new SettingsPanel(rows, () => {
      this.overlayOpen = false
      this.settingsPanel = undefined
      handle.hide()
    }, (index) => { this.handlers?.onSettingsRowPicked?.(index) },
    (index, direction) => { this.handlers?.onSettingsRowCycle?.(index, direction) })
    this.settingsPanel = panel
    this.overlayOpen = true
    const handle = tui.showOverlay(panel, {
      anchor: 'bottom-left', offsetY: -6, maxHeight: '50%', width: this.overlayWidth - 8,
    })
    tui.setFocus(panel)
  }

  /** /plugins 能力清单（M3，H20/H21 代理视图：命令/技能/投影分区）。 */
  showPlugins(rows: readonly PluginsRow[]): void {
    const tui = this.tui
    if (tui === undefined) return
    const panel = new PluginsPanel(rows, () => {
      this.overlayOpen = false
      handle.hide()
    }, (action) => { this.handlers?.onPluginsRowPicked?.(action) })
    this.overlayOpen = true
    const handle = tui.showOverlay(panel, {
      anchor: 'bottom-left', offsetY: -6, maxHeight: '60%', width: this.overlayWidth - 8,
    })
    tui.setFocus(panel)
  }

  /** One searchable overlay for every chooser; rows mark the current value. */
  private showChoicePicker(
    title: string,
    rows: readonly PickerRow[],
    onPicked: (value: string | null) => void,
    onFilter?: (query: string) => void,
    onActivity?: () => void,
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
    }, onFilter, onActivity)
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
        // cc classic（regular 默认）：`❯` 前缀 + 纯文本回显（V1）；fullscreen 保持气泡。
        const classic = this.keymap === 'cc' && this.regular
        // V2：fullscreen 下 cc 预设补 `You` 归属标签（气泡上方一行）。
        const youLabel = this.keymap === 'cc' && !this.regular ? strings().youLabel : undefined
        const inner = new UserMessageComponent(entry.text, this.markdownTheme, 1, [codeLabelTransformer, mermaidTransformer], classic, youLabel)
        inner.setFooter(clockFooter(entry.at))
        return frameOrSelf(maybeCollapse(inner, entry.text), '用户消息')
      }
      case 'assistant': {
        const { provider, model } = this.modelIdentity()
        // V2：fullscreen 下 cc 预设补 `Claude` 归属标签（内容上方一行）。
        const claudeLabel = this.keymap === 'cc' && !this.regular ? strings().claudeLabel : undefined
        const inner = new AssistantMessageComponent(
          synthesizeAssistantMessage(entry, provider, model),
          this.hideThinking,
          this.markdownTheme,
          'Thinking…',
          1,
          [codeLabelTransformer, mermaidTransformer],
          claudeLabel,
        )
        // cc 语式：思考结束后自动收起成一行（Claude Code 对齐）。
        inner.setAutoCollapseThinking(this.ccAutoCollapse && entry.state !== 'streaming')
        // V3: 折叠行 CC 式实时时钟 `Thinking for Ns`（流式中跳秒、结束后定格）。
        inner.setThinkingClock(entry.firstChunkAt, entry.state === 'streaming' ? undefined : entry.at)
        inner.setFooter(assistantFooter(entry, this.current))
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
        // cc 语式：执行中过程流式可见（全量），结束后自动收起为摘要行。
        card.setDone(entry.state !== 'running')
        if (this.ccAutoCollapse) card.setAutoCollapsed(entry.state !== 'running')
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
      // cc 语式：思考结束后自动收起（streaming 中保持展开）。
      raw.setAutoCollapseThinking(this.ccAutoCollapse && entry.state !== 'streaming')
      raw.updateContent(synthesizeAssistantMessage(entry, provider, model), entry.state === 'streaming')
      raw.setFooter(assistantFooter(entry, doc))
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
      view.setAutoCollapseThinking(this.ccAutoCollapse && entry.state !== 'streaming')
      view.updateContent(synthesizeAssistantMessage(entry, provider, model), entry.state === 'streaming')
      view.setFooter(assistantFooter(entry, doc))
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
      inner.setAutoCollapseThinking(this.ccAutoCollapse && entry.state !== 'streaming')
      inner.setFooter(assistantFooter(entry, doc))
      view.replaceInner(inner, entry.text)
    } else if (entry.kind === 'tool' && view instanceof FocusableToolCard) {
      if (entry.state !== 'running' && entry.output !== undefined) {
        view.inner.updateResult(synthesizeToolResult(entry))
      }
      view.setDone(entry.state !== 'running')
      // cc 语式：执行中全量流式，结束后自动收起为摘要行。
      if (this.ccAutoCollapse) view.setAutoCollapsed(entry.state !== 'running')
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
        effort: this.meta.effort,
        breakdown: this.meta.contextBreakdown,
      })
  }

  /** Reconcile the mounted views with one document snapshot (incremental by entry identity). */
  private applyState(doc: ViewDocument): void {
    const editor = this.editor
    if (this.tui === undefined || editor === undefined) return
    // V4: cc 预设输入框边框色随权限语义（workspace-write 蓝 / full-access
    // 红 / read-only 灰；pi/opencode 保持主题默认边框）。
    if (this.keymap === 'cc' && doc.permissionPreset !== undefined) {
      editor.borderColor = permissionTone(doc.permissionPreset)
    } else if (this.keymap !== 'cc') {
      editor.borderColor = getEditorTheme().borderColor
    }

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
        // regular：视图状态已变，失效该条目的行缓存（增量追加）。
        if (this.document instanceof CachedTranscript) this.document.invalidateEntry(existing)
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
    const following = this.scrollView?.isFollowingEnd ?? true
    // B16: NewMessagesPill 计数——离开底部时快照条目数，之后新增即 pill；
    // 回到底部清除基线（与 F2 的回底提示共用同一状态）。
    if (following) {
      this.offBottomBaseline = undefined
      this.newMessages = 0
    } else if (this.offBottomBaseline === undefined) {
      this.offBottomBaseline = this.current.entries.length
    }
    this.newMessages = this.offBottomBaseline === undefined
      ? 0
      : Math.max(0, this.current.entries.length - this.offBottomBaseline)
    const offBottom = !following
    const endHint = offBottom
      ? ` · ${this.newMessages > 0 ? fg('accent')(`↓ ${strings().newMessages(this.newMessages)}`) + ' · ' : ''}${fg('dim')(`↓ ${strings().backToBottom} (End)`)}`
      : ''
    if (doc.busy) {
      // The fixed slot ABOVE the input line carries running state only
      // (web: the composer area itself never shows the stats strip — it
      // lives in the composer.dock under the input line, our footer).
      // Shortcut hints deliberately do not render here (see /hotkeys).
      if (!this.wasBusy) {
        this.busyStartedAt = Date.now()
        // 2026-08-21 用户决策：cc 预设保留 dsh 标志性文案 Deep diving...（折中），
        // 不用 CC 随机动词；但仍保留 CC 语式的括号恒常时钟与星芒 spinner。
      }
      const seconds = Math.floor((Date.now() - this.busyStartedAt) / 1000)
      // 时钟：cc 预设对齐 Claude Code 的恒常耗时（括号包裹、从 0s 起就显示）；
      // 其他预设保留 web parity（Deep diving... 15s 后才加时钟）。
      const isCC = this.keymap === 'cc'
      const clock = isCC || seconds >= 15
        ? seconds >= 60
          ? strings().durationMinutes(Math.floor(seconds / 60), String(seconds % 60).padStart(2, '0'))
          : strings().durationSeconds(seconds)
        : ''
      const diving = strings().diving
      // cc 预设的耗时带括号（对齐 CC `✻ Herding… (8m 39s · ↓ N tokens)` 语式段）；
      // 其他预设保持 web 的空格拼接。
      const busyText = clock === '' ? diving : isCC ? `${diving} (${clock})` : `${diving} ${clock}`
      // C1: live decode gauge (streaming entry's recent sample window).
      let gauge = liveGaugeText(doc)
      // V5: cc 预设 busy 行追加 `↓ N tokens`（CC 语式尾部；流式中无逐
      // token usage，用 decodeSamples 的字符累计近似，与 C1 同口径）。
      if (isCC) {
        const streaming = streamingEntry(doc)
        if (streaming?.decodeSamples !== undefined && streaming.decodeSamples.length > 0) {
          const chars = streaming.decodeSamples.reduce((sum, s) => sum + s.chars, 0)
          gauge = `${gauge ?? ''}${gauge === undefined ? '' : ' '}· ↓ ${Math.round(chars / CHARS_PER_TOKEN)} tokens`
        }
      }
      // 排队不只给数量：队首消息预览让用户知道自己排了什么（/queue dock 看全量）。
      const queued = this.queueCount > 0 ? ` · ${strings().queueFirst(this.queueCount, queuePreview(this.queueMessages))}` : ''
      slot.setMessage(`${busyText}${gauge ?? ''}${queued}${endHint}`)
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
        // CC-01：permissions 投影的当前值按危险等级分色 + web 同款显示名
        // （Workspace Write / Full access），其余投影保持中性。
        const styled = row.key === 'permissions'
          ? permissionTone(row.currentValue)(permissionDisplayName(current))
          : fg('text')(current)
        return `ℹ ${fg('info')(label)}：${styled}`
      })
      .join(' · ')
    const idleBase = this.projections.length > 0
      ? projectionLine
      : doc.permissionPreset === undefined
        ? ''
        : `ℹ ${fg('info')('权限预设')}：${permissionTone(doc.permissionPreset)(permissionDisplayName(doc.permissionPreset))}`
    // 离开底部时回底提示 + 新消息 pill 挂到 idle 行（F2/B16）；idleBase 为空时
    // 提示独占该行（去掉 endHint 的前导分隔符）。
    slot.setIdleLine(offBottom
      ? `${idleBase}${endHint}`.replace(/^ · /, '')
      : idleBase)
    slot.setBusy(doc.busy)
  }

  /** Bottom-anchor the transcript when it is shorter than the viewport (T7). */
  private updateBottomPadding(): void {
    const scroll = this.scrollView
    const width = this.terminal?.columns ?? 100
    let content = 0
    for (const key of this.entryOrder) {
      const view = this.entryViews.get(key)
      if (view !== undefined) content += view.render(width).length
    }
    // regular 模式无 ScrollView：钉底 = 终端高度 - chrome 高度 - 转录内容。
    // chrome = header + 两条 border + 面板 + 状态槽 + footer + 编辑器（动态行数）。
    const chrome = this.regular
      ? (this.header?.render(width).length ?? 0)
        + 2
        + this.capabilityPanel.render(width).length
        + (this.statusSlot?.render(width).length ?? 0)
        + this.footerLine.render(width).length
        + (this.editor?.render(width).length ?? 0)
      : 0
    const viewportHeight = scroll?.viewportHeight ?? Math.max(1, (this.terminal?.rows ?? 24) - chrome)
    const pad = Math.max(0, viewportHeight - content)
    if (pad !== this.bottomPad.height) {
      this.bottomPad.setHeight(pad)
      // regular：BottomPad 行缓存失效（高度已变）。
      if (this.document instanceof CachedTranscript) this.document.invalidateEntry(this.bottomPad)
    }
  }

  /** Put a retrieved queued message back into the composer (T5②). */
  restoreToEditor(text: string): void {
    this.editor?.setText(text)
    this.setFocusIndex(-1)
    this.tui?.requestRender()
  }

  /** The runner reports the pending message queue length + 内容（T1⑤）。 */
  notifyQueue(count: number, messages?: readonly string[]): void {
    this.queueCount = count
    this.queueMessages = messages === undefined ? [] : [...messages]
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
    this.editor?.setAutocompleteProvider(new AtFileAutocompleteProvider(
      new CombinedAutocompleteProvider([], path),
      path,
    ))
    this.applyState(this.current)
    this.tui?.requestRender()
  }

  /** Ctrl+F: query → match list → jump the transcript to the picked match (T2②). */
  private async startSearch(): Promise<void> {
    // regular 模式无应用滚动（scrollTo 依赖 scrollTop），搜索跳转不可用。
    if (this.scrollView === undefined) {
      this.toast(strings().searchUnavailableRegular, 'error')
      return
    }
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

  /** 回填输入框（B7 rewind：把原消息放回输入框供修改重发）。 */
  setComposerText(text: string): void {
    this.editor?.setText(text)
    this.tui?.requestRender()
  }

  /**
   * B9: 发送前展开消息里的 @ 引用——`@path` / `@"path"` 指向的文本文件内容或
   * 目录列表自动附加到消息尾部（CC 语义）；不存在/超限/不可读的引用保留原文。
   */
  private expandAtReferences(text: string): string {
    const workspace = this.meta.workspace ?? process.cwd()
    const blocks: string[] = []
    const expanded = text.replace(/@"([^"]+)"|@([^\s]+)/g, (match: string, quotedPath: string | undefined, plainPath: string | undefined) => {
      const path = quotedPath ?? plainPath
      if (path === undefined) return match
      const resolved = resolveAtPath(workspace, path)
      if (resolved === undefined) return match
      if (resolved.stat.isDirectory()) {
        try {
          const names = readdirSync(resolved.absolute).slice(0, 50).join('\n')
          const display = path.endsWith('/') ? path : `${path}/`
          blocks.push(`── ${display} ──\n${names}`)
        } catch {
          // 目录不可读：保留原文
        }
        return match
      }
      if (resolved.stat.size > PiTuiApp.AT_ATTACH_MAX_BYTES) return match
      try {
        const content = readFileSync(resolved.absolute, 'utf8')
        blocks.push(`── ${path} ──\n${content}`)
      } catch {
        // 读取失败（二进制等）：保留原文
      }
      return match
    })
    return blocks.length === 0 ? text : `${expanded}\n\n${blocks.join('\n\n')}`
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

  /**
   * $EDITOR 撰写长消息（pi A3）：pi 预设 Ctrl+G / cc 预设 `/compose`。
   * 挂起 alt screen → 打开临时草稿（首行占位注释）→ 恢复 → 读回正文提交；
   * 草稿被清空则提示不发送。
   */
  async composeInEditor(): Promise<void> {
    if (this.tui === undefined) return
    const path = join(tmpdir(), `dsh-tui-compose-${Date.now()}.md`)
    try {
      writeFileSync(path, `${strings().composePlaceholder}\n`, 'utf8')
    } catch {
      this.toast(strings().composeEmpty, 'error')
      return
    }
    try {
      await this.openExternalEditor(path)
      let text = readFileSync(path, 'utf8')
      const placeholder = strings().composePlaceholder
      if (text.startsWith(placeholder)) text = text.slice(placeholder.length)
      text = text.replace(/^\n+/, '').trimEnd()
      if (text.trim() === '') {
        this.toast(strings().composeEmpty, 'info')
        return
      }
      this.handlers?.onInput(text)
    } catch (error) {
      this.toast(strings().composeFailed(error instanceof Error ? error.message : String(error)), 'error')
    } finally {
      try {
        rmSync(path, { force: true })
      } catch {
        // 临时草稿清理失败无害。
      }
    }
  }

  /** B18: cc 预设 Ctrl+X——用 $EDITOR 编辑当前输入，保存退出后回填输入框
   *  （不自动发送；与 /compose 的"撰写新消息并发送"区分）。 */
  async editInputInEditor(): Promise<void> {
    if (this.tui === undefined) return
    const initial = this.editor?.getText() ?? ''
    const path = join(tmpdir(), `dsh-tui-edit-${Date.now()}.md`)
    try {
      writeFileSync(path, initial, 'utf8')
    } catch {
      this.toast(strings().editorUnset, 'error')
      return
    }
    try {
      await this.openExternalEditor(path)
      const edited = readFileSync(path, 'utf8').replace(/^\n+/, '').trimEnd()
      if (edited !== initial) this.setComposerText(edited)
    } catch (error) {
      this.toast(strings().composeFailed(error instanceof Error ? error.message : String(error)), 'error')
    } finally {
      try {
        rmSync(path, { force: true })
      } catch {
        // 临时草稿清理失败无害。
      }
    }
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
      // 广义交互层：审批/提问卡形态随键位预设（cc 无边框 / pi 圆角卡 /
      // opencode 居中）。
      return await presentApprovalDialog(this.tui, question, undefined, 120_000, this.overlayWidth, question.icon ?? '？', keymapById(this.keymap).interaction.card)
    } finally {
      this.overlayOpen = false
    }
  }
}
