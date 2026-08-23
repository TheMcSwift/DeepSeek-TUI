/**
 * `dsh-tui-app` — the interactive terminal surface over dsh-base. The runner
 * creates one Agent through the core registry (or resumes a persisted
 * session), folds committed session events through the pure reducer into the
 * chat view, and delegates terminal lifecycle to a {@link TerminalApp}
 * (pi-tui by default, a fake in tests).
 * @module dsh-tui-app
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { billedInputTokens, cacheHitPercent, formatTokens, sessionStats } from './projection/stats.ts'
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
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { PiTuiApp, piTuiInternals } from './app/pi-tui-app.ts'
import { applyPalette, resolveHex } from './app/pi/color.ts'
import { applyCustomThemeColors } from './app/pi/palette.ts'
import { detectThemeLive, resolveThemeVariant } from './app/pi/theme-detect.ts'
import { installApprovals } from './control/approvals.ts'
import { DEFAULT_SESSION_MODES, nextSessionMode } from './control/session-modes.ts'
import { emptyDocument, transcriptText } from './document/document.ts'
import { resolveLanguage, setStrings, strings } from './view/strings.ts'
import { fold, replay } from './projection/fold.ts'
import { feedbackSummary, readFeedback, writeFeedback } from './session/feedback.ts'
import type { FeedbackRecord } from './session/feedback.ts'
import { approvalContext, contextReport, findToolCall, relTime, trajectorySummary } from './control/summaries.ts'
import { isKeymapId, KEYMAPS, keymapById } from './app/pi/keymaps.ts'
import type { KeymapId } from './app/pi/keymaps.ts'
import { FRAME_SETS, isFrameId } from './app/pi/frames.ts'
import type { FrameId } from './app/pi/frames.ts'
import { permissionDisplayName } from './app/pi/command-match.ts'
import { isThemePresetId, THEME_PRESETS } from './app/pi/theme-presets.ts'
import type { ThemePresetId } from './app/pi/theme-presets.ts'
import type { ViewDocument } from './document/document.ts'

/** 快捷键预设 sidecar（与反馈/历史同目录的 TUI 自有配置）。 */
function keymapFile(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'tui-keymap.txt')
}

/** 读取持久化的快捷键预设；缺失/损坏返回 undefined（回退 cc）。 */
function loadPersistedKeymap(): KeymapId | undefined {
  try {
    const value = readFileSync(keymapFile(), 'utf8').trim()
    return isKeymapId(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** 把预设写进 sidecar；只读 home 不致命。 */
function persistKeymap(id: KeymapId): void {
  try {
    mkdirSync(dirname(keymapFile()), { recursive: true })
    writeFileSync(keymapFile(), `${id}\n`)
  } catch {
    // A read-only home must not break the surface.
  }
}

// ---- 会话标题缓存（picker 列表的廉价标题源）。
// 平台侧没有廉价的持久化标题读取：sessionQuery.readTitle 对每个已持久化
// 会话整读日志（大日志一次 0.5s+ 的主线程解压解析，几百个会话直接卡死
// 面板交互）。TUI 在会话切换/退出/重命名时把已知标题写进自家 sidecar，
// picker 打开时直接命中；未命中的条目仅在空闲时逐个回填（见 fillTitles）。

/** 标题缓存 sidecar（与 keymap/theme 同目录）。 */
function titlesFile(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'tui-titles.json')
}

/** 缓存条目：标题 + 最近记录时间（裁剪用）。 */
interface TitleCacheEntry {
  title: string
  at: number
}

/** 缓存条数上限：超出按最近使用裁剪，避免无限增长。 */
const TITLES_CACHE_LIMIT = 1000

/** 读取标题缓存；缺失/损坏/脏条目回退空表（picker 显示短 id）。 */
function loadTitleCache(): Record<string, TitleCacheEntry> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(titlesFile(), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return {}
    const cache: Record<string, TitleCacheEntry> = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      const title = (value as { title?: unknown } | undefined)?.title
      const at = (value as { at?: unknown } | undefined)?.at
      if (typeof title === 'string' && title !== '' && typeof at === 'number') cache[id] = { title, at }
    }
    return cache
  } catch {
    return {}
  }
}

/** 写回标题缓存（裁剪到上限；只读 home 静默降级）。 */
function persistTitleCache(cache: Record<string, TitleCacheEntry>): void {
  try {
    const pruned: Record<string, TitleCacheEntry> = {}
    const entries = Object.entries(cache).sort((a, b) => b[1].at - a[1].at)
    for (const [id, value] of entries.slice(0, TITLES_CACHE_LIMIT)) pruned[id] = value
    mkdirSync(dirname(titlesFile()), { recursive: true })
    writeFileSync(titlesFile(), JSON.stringify(pruned))
  } catch {
    // A read-only home must not break the surface.
  }
}

/** 视觉主题预设 sidecar。 */
function themePresetFile(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'tui-theme-preset.txt')
}

/** 会话 MRU sidecar（D2）：切换/打开时记录 epoch，picker 排序驱动。 */
function mruFile(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'tui-mru.json')
}

const MRU_LIMIT = 300

/** 读取 MRU 表；缺失/损坏回退空表（picker 保持 listSessions 顺序）。 */
function loadMru(): Record<string, number> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(mruFile(), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return {}
    const mru: Record<string, number> = {}
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) mru[id] = value
    }
    return mru
  } catch {
    return {}
  }
}

/** 记录一次使用并裁剪到上限（只读 home 静默降级）。 */
function touchMru(id: string): void {
  const mru = loadMru()
  mru[id] = Date.now()
  try {
    const pruned: Record<string, number> = {}
    const entries = Object.entries(mru).sort((a, b) => b[1] - a[1])
    for (const [key, value] of entries.slice(0, MRU_LIMIT)) pruned[key] = value
    mkdirSync(dirname(mruFile()), { recursive: true })
    writeFileSync(mruFile(), JSON.stringify(pruned))
  } catch {
    // A read-only home must not break the surface.
  }
}

function loadPersistedThemePreset(): string | undefined {
  try {
    const value = readFileSync(themePresetFile(), 'utf8').trim()
    return value === '' ? undefined : value
  } catch {
    return undefined
  }
}

/** F1: 自定义主题目录 `$DSH_HOME/tui-themes/<名>.json`（文件名即主题名，路径穿越防护）。 */
function customThemesDir(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'tui-themes')
}

export interface CustomTheme {
  name: string
  colors: Record<string, string>
}

/** 自定义主题加载：损坏/未知角色/非法 hex 跳过——只留已知语义色的合法覆盖。 */
function loadCustomThemes(): CustomTheme[] {
  const dir = customThemesDir()
  let files: string[]
  try {
    files = readdirSync(dir).filter(file => file.endsWith('.json'))
  } catch {
    return []
  }
  const themes: CustomTheme[] = []
  for (const file of files) {
    if (file.includes('/') || file.includes('\\') || file.startsWith('.')) continue
    try {
      const parsed: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      const raw = (parsed as { colors?: unknown } | undefined)?.colors
      if (typeof raw !== 'object' || raw === null) continue
      const colors: Record<string, string> = {}
      for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) continue
        if (resolveHex(key) !== undefined) colors[key] = value
      }
      if (Object.keys(colors).length === 0) continue
      themes.push({ name: file.slice(0, -'.json'.length), colors })
    } catch {
      // 损坏 JSON：跳过该主题。
    }
  }
  return themes
}

function persistThemePreset(id: ThemePresetId): void {
  try {
    mkdirSync(dirname(themePresetFile()), { recursive: true })
    writeFileSync(themePresetFile(), `${id}\n`)
  } catch {
    // A read-only home must not break the surface.
  }
}

/** One persisted reply rating (TUI-owned sidecar; the web keeps its own store). */
// 反馈 sidecar 的读写/汇总已拆到 src/session/feedback.ts（T2②）。

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

/** Flush the session and reveal its durable jsonl artifact path (T1⑦). */
/** 导出会话日志（B12）：`jsonl` = 展示持久化路径（web 语义）；`md` = 写
 *  Markdown 分节导出（CC 语义，`/export md` 触发），notice 展示路径。 */
async function exportSessionLog(
  ctx: Context,
  sessions: SessionStore,
  session: Session,
  doc: ViewDocument,
  format: 'jsonl' | 'md' = 'jsonl',
  cwd?: string,
): Promise<ViewDocument> {
  await sessions.flush(session)
  if (format === 'md') {
    const target = cwd ?? process.cwd()
    const file = `dsh-tui-export-${Date.now()}.md`
    const path = join(target, file)
    try {
      writeFileSync(path, exportMarkdown(doc, session), 'utf8')
      return {
        ...doc,
        entries: [...doc.entries, { kind: 'notice' as const, id: `notice:export:${session.id}`, text: `已导出会话 Markdown：${path}`, tone: 'info' as const }],
      }
    } catch (error) {
      return {
        ...doc,
        entries: [...doc.entries, {
          kind: 'notice' as const, id: `notice:export:${session.id}`,
          text: `Markdown 导出失败：${error instanceof Error ? error.message : String(error)}`, tone: 'error' as const,
        }],
      }
    }
  }
  const location = ctx.get('sessionPersistence')?.locate(session.header)
  const text = location?.path !== undefined
    ? `会话日志已导出（jsonl）：${location.path}`
    : `会话日志已 flush；jsonl 位于 DSH_HOME 会话目录（session ${session.id}）`
  return {
    ...doc,
    entries: [...doc.entries, { kind: 'notice' as const, id: `notice:export:${session.id}`, text, tone: 'info' as const }],
  }
}

/** B12: 把文档流转成 Markdown 分节导出（用户/思考/助手/工具），CC 的 /export 语义。 */
function exportMarkdown(doc: ViewDocument, session: Session): string {
  const lines: string[] = ['# dsh-tui 会话导出', '']
  lines.push(`- 会话：${session.id}`)
  lines.push(`- 导出时间：${new Date().toISOString()}`)
  lines.push('')
  for (const entry of doc.entries) {
    switch (entry.kind) {
      case 'user':
        lines.push(`## 用户\n\n${entry.text}`)
        break
      case 'assistant':
        lines.push(`## 助手\n\n${entry.text}`)
        break
      case 'tool': {
        const blocks = entry.output?.blocks ?? []
        const output = blocks.map(block => {
          if (block.type === 'text' && 'text' in block) return String((block as { text: unknown }).text)
          if (block.type === 'tool-result') {
            const result = block as { result?: { output?: unknown; isError?: boolean } }
            return `${result.result?.isError === true ? '错误' : '输出'}：${typeof result.result?.output === 'string' ? result.result.output : JSON.stringify(result.result?.output ?? '')}`
          }
          return ''
        }).filter(text => text !== '').join('\n')
        lines.push(`## 工具：${entry.name}\n\n参数：\`\`\`json\n${entry.arguments}\n\`\`\`\n\n${output}`)
        break
      }
      default:
        break // notice/status/goal/todo 等不进入导出
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** B13: 当前目录的 git 分支（best-effort；非 git 仓库返回空）。 */
function gitBranch(cwd: string): string {
  try {
    const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', timeout: 2000 })
    if (result.status !== 0) return ''
    const branch = (result.stdout ?? '').trim()
    return branch === '' ? '' : branch
  } catch {
    return ''
  }
}

/** B13: /init 写入的 AGENTS.md 模板骨架。 */
const AGENTS_TEMPLATE = `# 项目

## 约定

- 运行与构建：见 README 或包脚本。
- 测试：\`pnpm test\`。
- 提交规范：见仓库 CONTRIBUTING 或 AGENTS.md 指南。
`

import type { SurfaceMeta, TerminalApp, TerminalAppHandlers, ModelChoice, PluginsRow, ProjectionRow, SettingsRow, TrajectoryRow } from './app/terminal-app.ts'

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
  /** regular 渲染模式（主屏输出留在 scrollback；--regular / DSH_TUI_REGULAR=1）。 */
  regular?: boolean
}

/** Surface factory seam; tests replace it with a fake. */
export const internals: {
  createApp: (themePreset: ThemePresetId, variant: 'dark' | 'light', regular?: boolean) => TerminalApp
  /** Whether stdin/stdout are a usable interactive terminal. */
  isTty: () => boolean
  /** Settle window between the two quit/swap flushes (tests shorten it). */
  flushSettleMs: number
  /** Sink for the transcript dump printed on quit (tests capture it). */
  writeStdout: (text: string) => void
  /** Grace window before the hard exit backstop fires (tests shorten it). */
  forceExitMs: number
  /**
   * Hard-exit backstop armed after the launcher's exit request. Production
   * kills the process; tests stub it, otherwise the armed timer would exit the
   * vitest worker mid-run（`process.exit unexpectedly called with "0"`）。
   */
  forceExit: (code: number) => void
  /** 会话 picker 标题回填的空闲等待窗口（用户停止按键后多久开始读下一个标题）。 */
  pickerTitleIdleMs: number
  /** 启动时后台标题回填（跨版本恢复标题缓存）；测试关闭。 */
  titleBackfillEnabled: boolean
  /** 每次启动标题回填的读取上限（大日志整读会占用主线程，限制单次启动的负担）。 */
  titleBackfillCap: number
} = {
  flushSettleMs: 400,
  pickerTitleIdleMs: 600,
  titleBackfillEnabled: true,
  titleBackfillCap: 50,
  writeStdout: (text: string) => { process.stdout.write(text) },
  forceExitMs: 2_000,
  forceExit: (code: number) => { process.exit(code) },
  createApp: (themePreset: ThemePresetId, variant: 'dark' | 'light', regular?: boolean) => {
    // Language resolves before any view is built: DSH_TUI_LANG=en picks the
    // English dictionary, default zh (T9 i18n).
    setStrings(resolveLanguage(process.env.DSH_TUI_LANG))
    // 视觉主题预设（web/cc/pi/opencode）× 明暗变体：preset 经 env/sidecar，
    // 变体沿用 DSH_TUI_THEME=light|dark|auto（OSC11 探测，默认 dark）。
    applyPalette(themePreset, variant)
    return new PiTuiApp({
      historyFile: join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'tui-history.json'),
      // 快捷键预设：env 优先，其次 $DSH_HOME/tui-keymap.txt 持久化值，缺省 cc。
      keymap: isKeymapId(process.env.DSH_TUI_KEYMAP ?? '') ? process.env.DSH_TUI_KEYMAP as KeymapId : loadPersistedKeymap() ?? 'cc',
      // regular 显式 false（--fullscreen）也要透传，否则 PiTuiApp 默认解析回 regular。
      ...(regular === undefined ? {} : { regular }),
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

/** tui 命名空间的组合默认（settings.yaml `tui:` 段的 base 层）。
 *  enterBehavior 默认 'auto' = 按预设解析（cc=steer、其他=queue，BACKLOG-CC-PARITY B1）；
 *  用户显式设置 steer/queue 后写对应值并覆盖预设默认。 */
const TUI_SETTINGS_DEFAULTS = { enterBehavior: 'auto', anim: 'on', footerMode: 'full', activityFrames: 'star' } as const

/** tui 命名空间 schema：写入即校验；手改非法值在注册/写入点失败（平台惯例）。 */
const TuiSettingsSchema = z.object({
  enterBehavior: z.union([z.const('auto'), z.const('queue'), z.const('steer')]),
  anim: z.union([z.const('on'), z.const('off')]),
  footerMode: z.union([z.const('full'), z.const('compact'), z.const('minimal')]),
  activityFrames: z.union([z.const('star'), z.const('moon'), z.const('dots')]),
})

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
  // 注册 tui 设置命名空间：settings.yaml 的 `tui:` 段随 settings 服务挂载而可读写。
  // 服务缺席的最小组合里注入回调永不触发，TUI 退回组合默认照常可用（可选服务语义）。
  installSettingsSection(ctx, settingsNamespace('tui'), TuiSettingsSchema, TUI_SETTINGS_DEFAULTS, {
    // TUI 只在启动时与写入后读取，无需响应式联动；注册本身即持久化能力。
    setSource: () => {},
    onChange: () => {},
  })
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
  const themeVariant = resolveThemeVariant(process.env.DSH_TUI_THEME, detectThemeLive)
  const persistedTheme = isThemePresetId(process.env.DSH_TUI_THEME_PRESET ?? '')
    ? process.env.DSH_TUI_THEME_PRESET as ThemePresetId
    : loadPersistedThemePreset()
  let activeThemePreset: ThemePresetId = isThemePresetId(persistedTheme ?? '')
    ? persistedTheme as ThemePresetId
    : 'web'
  const bootKeymap: KeymapId = isKeymapId(process.env.DSH_TUI_KEYMAP ?? '') ? process.env.DSH_TUI_KEYMAP as KeymapId : loadPersistedKeymap() ?? 'cc'
  let activeKeymap: KeymapId = bootKeymap
  const app = internals.createApp(activeThemePreset, themeVariant, config.regular)
  /** 应用视觉主题预设：palette 热切换 + 视图重建 + 持久化 + toast。 */
  const applyThemePreset = (preset: ThemePresetId): void => {
    activeThemePreset = preset
    persistThemePreset(preset)
    applyPalette(preset, themeVariant)
    app.refreshTheme()
    app.toast(strings().themeSwitched(preset), 'success')
  }

  /** F1: 应用自定义主题（语义色覆盖层 + 持久化 + 视图重建）。 */
  const applyCustomTheme = (theme: CustomTheme): void => {
    applyCustomThemeColors(theme.colors)
    persistThemePreset(theme.name as ThemePresetId)
    applyPalette(activeThemePreset, themeVariant)
    app.refreshTheme()
    app.toast(strings().themeCustomSwitched(theme.name), 'success')
  }
  let doc = emptyDocument()
  let cmdSeq = 0
  /** A12: /btw 侧问的当前请求（再次触发时中止上一个）。 */
  let btwController: AbortController | undefined
  let handle: AgentHandle | undefined
  let currentSessionId = ''
  /** Shift+Tab 会话模式循环的当前档（B8；default 起步）。 */
  let currentModeId = 'default'
  let quitting = false
  /** 会话 picker 打开期间用户是否已输入过滤（H5 搜索接管行后不再标题回填）。 */
  let pickerFiltered = false
  /** 会话 picker 已关闭（选中/取消）：终止后台标题回填。 */
  let pickerClosed = false
  /** 会话 picker 内最近一次按键时刻：空闲窗口内才允许读下一个标题。 */
  let pickerActivityAt = 0
  /** 全局最近一次按键时刻：启动期标题回填只在全局空闲时读取。 */
  let lastUserActivityAt = Date.now()

  /** 把当前会话的已知标题写入标题缓存（切换/退出/重命名时调用）。 */
  const rememberCurrentTitle = (): void => {
    if (currentSessionId === '' || doc.title === undefined || doc.title === '') return
    const cache = loadTitleCache()
    const existing = cache[currentSessionId]
    if (existing !== undefined && existing.title === doc.title) return
    cache[currentSessionId] = { title: doc.title, at: Date.now() }
    persistTitleCache(cache)
  }
  const meta: SurfaceMeta = {
    model: `${selection.provider}/${selection.model}`,
    session: '',
    workspace: resolve(config.workspace ?? '.'),
  }

  const modelRef: ModelSelectionRef = { current: selection, assembled: undefined }
  /** 把当前 selection 的 reasoning effort 显示名回填到 footer meta（best
   *  effort）：未选或模型不支持时清空；解析失败退回 effort id 本身。 */
  const refreshEffortLabel = (): void => {
    const current = modelRef.current ?? selection
    if (current.reasoningEffort === undefined) {
      meta.effort = undefined
      return
    }
    void ctx.get('llm')?.resolveModelInfo?.(current.provider, current.model).then((info) => {
      const found = info?.reasoning?.efforts.find(item => item.id === current.reasoningEffort)
      meta.effort = found?.name ?? String(current.reasoningEffort)
      app.render(doc)
    }).catch(() => {
      meta.effort = String(current.reasoningEffort)
      app.render(doc)
    })
  }
  // 启动即回填：持久化选择可能已带 reasoningEffort（/effort 已存）。
  refreshEffortLabel()
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
    // K3: 投影快照跟随会话切换刷新（boot/fork/swap 之后调用）。
    refreshProjections()
  }

  // ---- Warp 通知（OSC 777）：turn 完成 / 审批请求 / 工具失败 → Warp 原生
  // 通知。协议是跨终端事实标准（Warp 官方文档公开格式
  // `ESC ] 777 ; notify ; <title> ; <body> BEL`；Ghostty/WezTerm 同实现），
  // 非 Warp 终端对未知 OSC 序列静默忽略。DSH_TUI_WARP_NOTIFY=off 关闭。
  const warpNotify = (title: string, body: string): void => {
    if (process.env.DSH_TUI_WARP_NOTIFY === 'off') return
    // `;` 是协议分隔符，BEL/ESC 是控制字符：正文一律清洗掉。
    const clean = (text: string): string => text.replace(/[\x07\x1b;]/g, ' ').replace(/\s+/g, ' ').trim()
    internals.writeStdout(`\x1b]777;notify;${clean(title)};${clean(body)}\x07`)
  }

  /** 通知摘要：最后一条已提交助手文本的首行，截断到一屏。 */
  const warpSummary = (): string => {
    for (let i = doc.entries.length - 1; i >= 0; i--) {
      const entry = doc.entries[i]
      if (entry.kind === 'assistant' && entry.state !== 'streaming' && entry.text.trim() !== '') {
        const firstLine = entry.text.split('\n')[0]?.trim() ?? ''
        return firstLine.length > 80 ? `${firstLine.slice(0, 80)}…` : firstLine
      }
    }
    return ''
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
    // Warp 通知事件映射（fold 之后取最新 doc 摘要）。
    if (event.type === 'turn/end') {
      if (event.data.reason.kind === 'completed') {
        warpNotify(strings().warpNotifyTitle, strings().warpTurnComplete(warpSummary()))
      } else if (event.data.reason.kind === 'error') {
        const code = (event.data.reason as { error?: { code?: string } }).error?.code ?? 'UNKNOWN'
        warpNotify(strings().warpNotifyTitle, strings().warpTurnFailed(code))
      }
    } else if (event.type === 'approval/asked') {
      warpNotify(strings().warpNotifyTitle, strings().warpApproval(event.data.toolName))
    } else if (event.type === 'tool/result' && event.data.error !== undefined) {
      warpNotify(strings().warpNotifyTitle, strings().warpToolError(event.data.error.name))
    }
    app.render(doc)
    // Queue drain: one pending message per settled turn, in FIFO order.
    // Never drain while quitting: /quit with a pending queue discards it.
    if (!quitting && !doc.busy && queue.length > 0 && handle !== undefined) {
      const next = queue.shift()
      if (next !== undefined) {
        app.notifyQueue(queue.length, queue)
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
    rememberCurrentTitle()
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
    // B19: 退出时打印恢复命令（远程 CC 复刻的退出提示；--no-session 不适用）。
    if (!config.noSession && meta.session !== '' && meta.session !== undefined) {
      internals.writeStdout(`${strings().resumeHint}: dsh --profile tui --resume ${meta.session}\n`)
    }
    exit(0)
    // The launcher's natural-completion path sets process.exitCode and relies
    // on the event loop draining. Some spawn chains (pnpm's sh wrapper) leave
    // a parent-watch handle behind that never drains, so force the exit after
    // a short grace — the session was already flushed and the agent disposed.
    // 走 internals 缝隙：测试把它替成 no-op，否则这枚 timer 会在 2s 后把
    // vitest worker 直接 exit 掉（整套单测以非 0 退出码结束）。arm 时就取定
    // 实现，免得 afterEach 恢复生产实现后这枚 timer 又去杀进程。
    const forceExit = internals.forceExit
    setTimeout(() => { forceExit(0) }, internals.forceExitMs).unref()
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
    rememberCurrentTitle()
    await handle.agent.whenIdle()
    await flushSettled(handle.agent.session)
    await handle.dispose()
    await boot(nextId)
  }

  // Messages entered while a turn runs queue here and drain FIFO at each
  // turn end (the web's Enter-as-Queue semantics, T1⑤).
  const queue: string[] = []
  const MAX_QUEUE = 10
  /** 插件 session 投影的交互行（K3），由 refreshProjections 维护。 */
  let projections: ProjectionRow[] = []

  /**
   * Fork the current session at `seq` (T2①) and swap the surface to the child.
   * `fallbackLast` falls back to the last completed turn when the anchor finds
   * none — the host's omitted-atSeq `/clone` semantics (T5⑦).
   * `cutOverride`（B7 rewind）：直接以给定的事件 index 为种子边界（回退到
   * 消息所属轮次起点之前），跳过 turn/end 锚定。
   */
  const forkSession = async (session: Session, seq: number, fallbackLast: boolean, label: string, cutOverride?: number): Promise<void> => {
    const events = session.events
    const boundary = cutOverride === undefined
      ? (events.find(event => event.type === 'turn/end' && event.seq >= seq)
        ?? (fallbackLast ? events.findLast(event => event.type === 'turn/end') : undefined))
      : undefined
    if (boundary === undefined && cutOverride === undefined) {
      doc = { ...doc, entries: [...doc.entries, {
        kind: 'notice' as const, id: `notice:fork:${cmdSeq++}`,
        text: '该消息所在轮次尚未完成，无法分支', tone: 'error' as const,
      }] }
      app.render(doc)
      return
    }
    let cut = cutOverride ?? events.indexOf(boundary!) + 1
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
    refreshProjections()
  }

  /**
   * B7: rewind 时间回溯——回退到所选用户消息**所属回合起点之前**（fork 分支 +
   * 回放），并把原消息放回输入框供修改重发（远程 dsh-TUI 的 /rewind 语义）。
   * 不能回退到第一条消息（种子为空）；busy 时 forkSession 的 whenIdle 会等待落定。
   */
  const rewindTo = async (session: Session, seq: number, text: string): Promise<void> => {
    const events = session.events
    const turnStart = [...events].reverse().find(event => event.type === 'turn/start' && event.seq < seq)
    if (turnStart === undefined) {
      app.toast(strings().rewindNoTarget, 'error')
      return
    }
    const cut = events.indexOf(turnStart)
    // 不能回退到第一条消息：种子（回退后的历史）里没有任何 user/message，
    // 回退结果是空对话（事件流里可能有 inbox 等非对话事件，不能只看 cut）。
    if (!events.slice(0, cut).some(event => event.type === 'user/message')) {
      app.toast(strings().rewindNoTarget, 'error')
      return
    }
    await forkSession(session, seq, false, strings().rewindNotice, cut)
    if (handle !== undefined) app.setComposerText(text)
  }

  /** The full command catalog: registered commands plus TUI-native specials. */
  const commandCatalog = (agent: Agent): Array<{ value: string; label: string; description?: string }> => {
    const commands = ctx.get('commands')
    // The plugin's /permission takes free text only; the TUI replaces it with
    // an enum-aware native row (`__permission`: picker when bare, direct
    // switch when an inline preset name rides the slash line), so the raw
    // descriptor leaves the catalog to avoid a duplicate menu row.
    const items = (commands === undefined ? [] : commands.list(agent))
      .filter(descriptor => descriptor.name !== 'permission')
      .map(descriptor => ({
        value: descriptor.name,
        label: `/${descriptor.name}${descriptor.input === undefined ? '' : ` ${descriptor.input.hint}`}`,
        description: descriptor.description,
      }))
    const push = (value: string, label: string, description: string, aliases?: string[]): void => {
      if (!items.some(item => item.value === value)) {
        items.push({ value, label, description, ...aliases === undefined ? {} : { aliases } })
      }
    }
    // The web's /export rides a browser-only download plugin; the TUI ships
    // native equivalents for the browser-specific commands. Aliases make
    // synonymous invocations resolve to the same command (K1).
    push('__export', '/export [md]', '导出会话：无参=jsonl 路径（web），md=Markdown 分节文件（CC）')
    push('__rate', '/rate · 评价最近回复', '👍/👎 最近一条助手回复（可选备注）')
    push('__new', '/new · 新会话', '原地开启新会话', ['clear'])
    push('__quit', '/quit · 退出 TUI', 'flush 会话并退出', ['exit'])
    push('__help', '/hotkeys · 快捷键', '全部快捷键一览', ['?'])
    push('__clone', '/clone · 复制当前会话', '以最后完成的轮次为种子开新会话')
    push('__resume', '/resume · 恢复会话', '列出历史会话并切换（会话选择器，Ctrl+R 同功能）', ['r'])
    push('__rewind', '/rewind · 时间回溯', '回退到一条用户消息：fork 分支 + 原消息回填输入框（空输入双击 Esc 同入口）')
    push('__status', '/status · 会话信息', '模型/状态/会话/目录/分支/tokens/上下文/标题')
    push('__tokens', '/tokens · token 明细', '输入/缓存读/缓存写/输出 + 缓存命中率')
    push('__cost', '/cost · token 用量', '汇总 in/out 用量（/tokens 的紧凑视图）')
    push('__doctor', '/doctor · 环境自检', '模型/目录/上下文窗口/API key 状态/配置路径')
    push('__init', '/init · 创建 AGENTS.md', '在会话目录写入 AGENTS.md 模板骨架')
    push('__agents', '/agents · 子代理列表', '本会话的子代理运行（◆ 徽标行）')
    push('__skills', '/skills · 技能目录', '可用技能清单（名称 + 描述）')
    push('__context', '/context · 已加载上下文', '系统提示/工作区指令/技能目录/工具清单注入明细')
    push('__tips', '/tips · 使用提示', '快捷键/命令/工作流/个性化/避坑 五组提示')
    push('__thinking', '/thinking · 思考折叠', 'Enabled/Disabled 选择（不持久化）')
    push('__btw', '/btw · 侧问', '无工具单轮回答（不进会话日志）')
    push('__activity', '/activity · 动画', '忙碌 spinner 帧预设（star/moon/dots）')
    push('__mcp', '/mcp · MCP 状态', 'MCP 连接说明与配置提示')
    push('__permissions', '/permissions · 权限说明', '当前 DSH profile 的权限策略说明')
    push('__login', '/login · 凭证状态', 'API 凭证配置状态说明')
    push('__logout', '/logout · 登出说明', '凭证清理说明')
    push('__add-dir', '/add-dir · 文件策略范围', '文件策略作用域说明')
    push('__hooks', '/hooks · 钩子说明', 'DSH 无等价机制的占位说明')
    push('__vim', '/vim · 说明', '无 Vim 模态编辑的占位说明')
    push('__terminal-setup', '/terminal-setup · 终端设置', '扩展键盘协议与粘贴说明')
    push('__connect', '/connect · 远程连接', '进程内客户端的远程连接说明')
    push('__effort', '/effort · 推理强度', '单独选择当前模型的 reasoning effort')
    push('__model', '/model <provider/model>', '切换模型：枚举选择，或直接指定 provider/model', ['m'])
    push('__permission', '/permission <preset>', '切换权限预设：枚举选择，或直接指定预设名', ['perm'])
    push('__config', '/config · 配置', '配置文件与供应商管理（查看/编辑/添加）')
    push('__lang', '/lang · 语言', '切换界面语言 zh/en', ['language'])
    push('__rename', '/rename · 重命名会话', '固定会话标题（替代自动生成）')
    push('__queue', '/queue · 查看队列', '列出排队消息：取回或删除（E1）')
    push('__trajectory', '/trajectory · 轨迹', '原始事件日志视图（Inspect，B11/H31）')
    push('__keymap', '/keymap [cc|pi|opencode]', '切换快捷键预设：Claude Code / pi / OpenCode 式键位')
    push('__theme', '/theme [web|cc|pi|opencode]', '切换视觉主题预设')
    push('__preset', '/preset [cc|pi|opencode]', '一键切换预设（快捷键 + 视觉主题）')
    push('__settings', '/settings · 设置', '聚合设置面板（语言/主题/Enter/键位/动画/配置）')
    push('__plugins', '/plugins · 插件与能力', '命令/技能/投影清单（H20/H21 代理视图）')
    push('__workspace', '/workspace · 工作区', '最近使用的工作目录列表（切换）')
    push('__compose', '/compose · 编辑器撰写', '在 $EDITOR 中撰写长消息并发送（pi A3）')
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

  /** Apply a `provider/model` pick: live ref + footer identity + persistence. */
  const applyModelPick = (value: string): boolean => {
    let next: ModelSelection
    try {
      next = resolveSelection(value, selection)
    } catch {
      return false
    }
    // Model and reasoning effort are chosen independently: a model switch
    // keeps the current effort; `/effort` switches it separately (T7).
    const current = modelRef.current ?? selection
    if (current.reasoningEffort !== undefined) next = { ...next, reasoningEffort: current.reasoningEffort }
    modelRef.current = next
    meta.model = `${next.provider}/${next.model}`
    // 换模型保留 effort id，但其显示名可能随模型不同：重新解析（best effort）。
    refreshEffortLabel()
    void defaultModel.saveSelection(next).catch(() => {})
    // Refresh the footer's context-window fact for the new model (best effort).
    void ctx.get('llm')?.resolveModelInfo?.(next.provider, next.model).then((info) => {
      meta.contextWindow = info?.context?.contextWindow
      app.render(doc)
    }).catch(() => {})
    app.render(doc)
    return true
  }

  /** Gather every provider's models as picker rows (`provider/model` keys). */
  const listModelChoices = async (): Promise<ModelChoice[]> => {
    const llm = ctx.get('llm')
    if (llm === undefined) return []
    const groups = await Promise.all(llm.listProviders().map(async (provider) => {
      const models = await llm.listModels(provider.id).catch(() => [])
      return models.map(model => ({
        value: `${model.provider}/${model.id}`,
        label: model.name || model.id,
        description: provider.name,
      }))
    }))
    return groups.flat()
  }

  /** Apply one preset pick: Full access asks first (web copy); others switch.
   *  @returns 是否真的应用了（false = 取消确认 / 无权限预设服务）。 */
  const switchPreset = async (value: string): Promise<boolean> => {
    if (handle === undefined) return false
    const presets = ctx.get('permissionPresets')
    if (presets === undefined) return false
    const agent = handle.agent
    const apply = (): boolean => {
      presets.set(agent.session, value)
      // 显示名与 web PermissionSelect 同口径（Workspace Write / Full access）。
      app.toast(strings().presetSwitched(permissionDisplayName(value)), 'success')
      app.render(doc)
      return true
    }
    if (value.includes('full-access') && presets.current(agent.session.events) !== value) {
      const answer = await app.askDialog({
        title: strings().fullAccessConfirmTitle,
        detail: strings().fullAccessConfirmDescription,
        options: [strings().fullAccessAcknowledge, strings().cancel],
        icon: '⚠',
      })
      if (answer.reason === 'picked' && answer.picked === strings().fullAccessAcknowledge) return apply()
      return false
    }
    return apply()
  }

  // ---- /config：web ui-settings 的终端对应（K2）。out-of-tree 约束下通过
  // 结构化读取 settings / llm 目录服务，与 web 配置页同源同写入路径。

  /** 结构读取 settings 服务（out-of-tree 无 dsh-settings 依赖）。 */
  interface SettingsSeam {
    readonly writable?: boolean
    readonly documentPath?: string
    prepareDocument?: () => Promise<string | undefined>
    get?: (ns: string) => unknown
    update?: (ns: string, patch: Record<string, unknown>) => Promise<unknown>
  }

  /** llm 可配置供应商目录条目（web 设置页同源）。 */
  interface ConfigurableProviderEntry {
    provider: string
    displayName: string
    settingsNs: string
    settingsPath: string[]
    declared: boolean
  }

  /** llm 服务的目录读面。 */
  interface LlmDirectorySeam {
    listConfigurableProviders?: () => ConfigurableProviderEntry[]
  }

  const settingsSeam = (): SettingsSeam | undefined =>
    (ctx as { get: (key: string) => unknown }).get('settings') as SettingsSeam | undefined

  // ---- M2：TUI 自有设置的 settings.yaml hydration（tui 命名空间，apply() 已注册）。
  // Enter 行为与动画开关在运行时改 env/internals；持久化经 settings seam（注册后
  // 写入真正落盘），启动时若 env 未显式设置则从 settings.yaml 回填。

  /** tui 命名空间的持久化段（结构化只读）。 */
  const tuiSettingsSection = (): { enterBehavior?: string; anim?: string; footerMode?: string; activityFrames?: string } | undefined => {
    const section = settingsSeam()?.get?.('tui')
    return typeof section === 'object' && section !== null
      ? section as { enterBehavior?: string; anim?: string; footerMode?: string; activityFrames?: string }
      : undefined
  }

  if ((process.env.DSH_TUI_ENTER ?? '') === '') {
    const saved = tuiSettingsSection()?.enterBehavior
    // 显式 steer/queue 回填 env；'auto'（默认）不写 env——cc 预设默认 steer、
    // 其他预设默认 queue（B1，解析在 pi-tui-app 的 busyEnterIsSteer）。
    if (saved === 'steer' || saved === 'queue') process.env.DSH_TUI_ENTER = saved
  }
  if ((process.env.DSH_TUI_ANIM ?? '') === '') {
    const saved = tuiSettingsSection()?.anim
    if (saved === 'off') piTuiInternals.animFrameMs = 0
    else if (saved === 'on') piTuiInternals.animFrameMs = 60
  }

  // F3/V8: footer 档位（读 tui 命名空间；启动应用一次，/settings 面板切换即时生效）。
  const footerMode = (): 'full' | 'compact' | 'minimal' => {
    const saved = tuiSettingsSection()?.footerMode
    return saved === 'compact' || saved === 'minimal' ? saved : 'full'
  }
  const applyFooterMode = (mode: 'full' | 'compact' | 'minimal'): void => {
    void settingsSeam()?.update?.('tui', { footerMode: mode }).catch(() => {})
    app.setFooterMode(mode)
  }
  // F3/V8: 启动时应用持久化的 footer 档位。
  app.setFooterMode(footerMode())
  // A15: 启动时应用持久化的忙碌帧预设。
  const savedFrames = tuiSettingsSection()?.activityFrames
  if (isFrameId(savedFrames ?? '')) app.setActivityFrames(savedFrames as FrameId)
  // F1: 启动时应用持久化的自定义主题（覆盖层 + 重建视图）。
  const bootCustomTheme = loadCustomThemes().find(theme => theme.name === persistedTheme)
  if (bootCustomTheme !== undefined) {
    applyCustomThemeColors(bootCustomTheme.colors)
    app.refreshTheme()
  }

  const llmDirectory = (): ConfigurableProviderEntry[] =>
    (ctx.get('llm') as LlmDirectorySeam | undefined)?.listConfigurableProviders?.() ?? []

  /** settings.yaml 的绝对路径：documentPath → prepareDocument → 默认位置。 */
  const settingsFilePath = async (): Promise<string> => {
    const settings = settingsSeam()
    if (settings?.documentPath !== undefined) return settings.documentPath
    if (settings?.prepareDocument !== undefined) {
      const prepared = await settings.prepareDocument().catch(() => undefined)
      if (prepared !== undefined) return prepared
    }
    return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'settings.yaml')
  }

  /** 应用语言切换（__lang 命令与 cc 语式的行内循环共用）。 */
  const applyLanguage = (lang: 'zh' | 'en'): void => {
    setStrings(lang)
    app.toast(lang === 'en' ? 'Language: English' : '语言：中文', 'success')
    app.render(doc)
  }

  /** 应用 Enter 行为（settings 面板与行内循环共用）。显式 queue 也写入 env：
   *  区分「用户显式选 queue」与「未设置（cc 预设默认 steer）」（B1）。 */
  const applyEnterBehavior = (steer: boolean): void => {
    process.env.DSH_TUI_ENTER = steer ? 'steer' : 'queue'
    void settingsSeam()?.update?.('tui', { enterBehavior: steer ? 'steer' : 'queue' }).catch(() => {})
    app.toast(strings().enterSwitched(steer ? strings().enterSteer : strings().enterQueue), 'success')
  }

  /** 应用动画开关（settings 面板与行内循环共用）。 */
  const applyAnim = (off: boolean): void => {
    piTuiInternals.animFrameMs = off ? 0 : 60
    if (off) process.env.DSH_TUI_ANIM = '0'
    else delete process.env.DSH_TUI_ANIM
    void settingsSeam()?.update?.('tui', { anim: off ? 'off' : 'on' }).catch(() => {})
    app.toast(strings().animSwitched(off ? strings().animOff : strings().animOn), 'success')
  }

  /** 键位三选：应用 + 持久化 + toast；当前项带 ● 标记；取消返回 false。 */
  const pickKeymap = async (): Promise<boolean> => {
    const picked = await new Promise<string | null>((resolve) => {
      app.showQueuePicker(KEYMAPS.map(keymap => ({
        value: keymap.id,
        label: keymap.label,
        current: keymap.id === activeKeymap,
      })), resolve, strings().keymap)
    })
    if (picked === null || !isKeymapId(picked)) return false
    activeKeymap = picked
    app.setKeymap(picked)
    persistKeymap(picked)
    app.toast(strings().keymapSwitched(picked), 'success')
    return true
  }

  /** 主题四选：应用 + 持久化 + toast；当前项带 ● 标记；取消返回 false。 */
  const pickTheme = async (): Promise<boolean> => {
    const customs = loadCustomThemes()
    const picked = await new Promise<string | null>((resolve) => {
      app.showQueuePicker([
        ...customs.map(theme => ({
          value: `custom:${theme.name}`,
          label: strings().themeCustomLabel(theme.name),
        })),
        ...THEME_PRESETS.map(preset => ({
          value: preset.id,
          label: preset.label,
          current: preset.id === activeThemePreset,
        })),
      ], resolve, strings().themePreset)
    })
    if (picked === null) return false
    if (picked.startsWith('custom:')) {
      const theme = customs.find(candidate => `custom:${candidate.name}` === picked)
      if (theme !== undefined) applyCustomTheme(theme)
      return theme !== undefined
    }
    if (!isThemePresetId(picked)) return false
    applyThemePreset(picked)
    return true
  }

  /** 明暗变体的显示名（/settings 主题行的现状值）。 */
  const themeVariantLabel = (): string => {
    const env = process.env.DSH_TUI_THEME
    if (env === 'auto') return strings().themeVariantAuto
    if (env === 'light') return strings().themeVariantLight
    return strings().themeVariantDark
  }

  /** busy Enter 生效语义（B1）：显式 env 优先；未显式按预设默认（cc=steer、其他=queue）。
   *  与 pi-tui-app 的 busyEnterIsSteer 同规则（runner 侧读 activeKeymap）。 */
  const effectiveEnterBehavior = (): 'steer' | 'queue' => {
    const saved = process.env.DSH_TUI_ENTER
    if (saved === 'steer' || saved === 'queue') return saved
    return activeKeymap === 'cc' ? 'steer' : 'queue'
  }

  /** /settings 面板行：现状值实时收集（面板是瞬态派生视图，不落文档）。
   * cc 语式下可循环行附带 cycle 数据（行内 ←/→ 切换而非弹选择器）。 */
  const settingsRows = async (): Promise<SettingsRow[]> => {
    const enter = effectiveEnterBehavior() === 'steer' ? strings().enterSteer : strings().enterQueue
    const anim = piTuiInternals.animFrameMs > 0 ? strings().animOn : strings().animOff
    const config = await settingsFilePath().catch(() => 'settings.yaml')
    const inline = keymapById(activeKeymap).interaction.enum === 'inline-cycle'
    const cycleOf = (options: string[], current: string): { options: string[]; current: string } | undefined =>
      inline ? { options, current } : undefined
    const footerModeLabel = (): string => {
      const mode = footerMode()
      return mode === 'compact' ? strings().footerCompact : mode === 'minimal' ? strings().footerMinimal : strings().footerFull
    }
    return [
      { key: strings().settingsLanguage, current: resolveLanguage(process.env.DSH_TUI_LANG), target: '→ /lang', cycle: cycleOf(['zh', 'en'], resolveLanguage(process.env.DSH_TUI_LANG)) },
      { key: strings().settingsTheme, current: `${themeVariantLabel()} · ${activeThemePreset}`, tone: 'accent', target: '→ /theme', cycle: cycleOf(THEME_PRESETS.map(preset => preset.id), activeThemePreset) },
      { key: strings().settingsEnter, current: enter, tone: 'info', target: '→ 切换', cycle: cycleOf(['queue', 'steer'], effectiveEnterBehavior()) },
      { key: strings().settingsKeymap, current: activeKeymap, tone: 'accent', target: '→ /keymap', cycle: cycleOf(KEYMAPS.map(keymap => keymap.id), activeKeymap) },
      { key: strings().settingsAnim, current: anim, target: '→ 切换', cycle: cycleOf(['on', 'off'], piTuiInternals.animFrameMs > 0 ? 'on' : 'off') },
      { key: strings().settingsFooter, current: footerModeLabel(), target: '→ 切换', cycle: cycleOf(['full', 'compact', 'minimal'], footerMode()) },
      { key: strings().settingsConfig, current: config, tone: 'muted', target: '→ /config' },
    ]
  }

  /** 打开 /settings 面板（已开则就地刷新行——主题切换后随新预设重绘）。 */
  const openSettings = async (): Promise<void> => {
    app.showSettings(await settingsRows())
  }

  /** 按 settingsPath 段从命名空间解析值里取出供应商 profile。 */
  const resolvedProfile = (entry: ConfigurableProviderEntry): unknown => {
    const settings = settingsSeam()
    const section = settings?.get?.(entry.settingsNs)
    let current: unknown = section
    for (const segment of entry.settingsPath) {
      if (typeof current !== 'object' || current === null) return undefined
      current = (current as Record<string, unknown>)[segment]
    }
    return current
  }

  /** /config 主菜单：列表 / 添加 / 预览 / 编辑 / 复制路径。 */
  const configMenu = async (): Promise<void> => {
    const answer = await app.askDialog({
      title: strings().configTitle,
      options: [
        strings().configProviders,
        strings().configAddProvider,
        strings().configPreview,
        strings().configOpenEditor,
        strings().configCopyPath,
      ],
    })
    if (answer.reason !== 'picked' || answer.picked === undefined) return
    const path = await settingsFilePath()

    if (answer.picked === strings().configProviders) {
      const directory = llmDirectory()
      if (directory.length === 0) {
        void app.askDialog({ title: strings().configProvidersTitle, detail: strings().configUnavailable, options: [strings().ok] }).then(() => {})
        return
      }
      const rows = directory.map((entry) => {
        const profile = resolvedProfile(entry) as Record<string, unknown> | undefined
        const overrides = profile === undefined ? '' : ` · ${JSON.stringify(profile)}`
        return {
          value: entry.provider,
          label: entry.displayName,
          description: `${entry.settingsNs}${entry.declared ? ' · 自定义路由' : ' · 内置目录'}${overrides}`,
        }
      })
      app.showQueuePicker(rows, (value) => {
        if (value === null) return
        const entry = directory.find(item => item.provider === value)
        if (entry === undefined) return
        const profile = resolvedProfile(entry)
        void app.askDialog({
          title: entry.displayName,
          detail: `${strings().configPath(path)}\n${JSON.stringify(profile, null, 2)}`,
          options: [strings().ok],
        }).then(() => {})
      }, strings().configProvidersTitle)
      return
    }

    if (answer.picked === strings().configAddProvider) {
      await addProviderWizard(path)
      return
    }

    if (answer.picked === strings().configPreview) {
      let preview = strings().configUnavailable
      try {
        const text = readFileSync(path, 'utf8')
        preview = text.split('\n').slice(0, 12).join('\n')
        if (text.split('\n').length > 12) preview += `\n…`
      } catch {
        preview = `文件不存在：${path}`
      }
      void app.askDialog({ title: strings().configPath(path), detail: preview, options: [strings().ok] }).then(() => {})
      return
    }

    if (answer.picked === strings().configOpenEditor) {
      await app.openExternalEditor(path)
      return
    }

    // configCopyPath
    app.copyText(path)
  }

  /** 交互式添加供应商：路由 → 字段 → 经 settings.update 写入并热生效。 */
  const addProviderWizard = async (path: string): Promise<void> => {
    const settings = settingsSeam()
    if (settings?.update === undefined) {
      app.toast(strings().configUnavailable, 'error')
      return
    }
    const directory = llmDirectory()
    // 第一步：路由（目录路由枚举 + 自定义新路由的自由文本）。
    const routeAnswer = await app.askDialog({
      title: strings().addProviderTitle,
      detail: strings().configPath(path),
      options: [...directory.map(entry => `${entry.provider} · ${entry.displayName}`), strings().addProviderRouteCustom],
    })
    if (routeAnswer.reason !== 'picked' || routeAnswer.picked === undefined) return
    let route: string
    let namespace = 'llm-pi-ai'
    if (routeAnswer.picked === strings().addProviderRouteCustom) {
      const typed = await app.askDialog({ title: strings().addProviderRoutePrompt, options: [] })
      if (typed.reason !== 'picked' || typed.picked === undefined || typed.picked.trim() === '') return
      route = typed.picked.trim()
    } else {
      const provider = routeAnswer.picked.split(' · ')[0]
      const entry = directory.find(item => item.provider === provider)
      if (provider === undefined || provider === '') return
      route = provider
      namespace = entry?.settingsNs ?? namespace
    }
    // 第二步：字段（displayName/baseURL/api/apiKeyEnv，全部可选）。
    const profile: Record<string, unknown> = {}
    const displayName = await app.askDialog({ title: strings().addProviderNamePrompt, options: [] })
    if (displayName.reason === 'picked' && displayName.picked !== undefined && displayName.picked.trim() !== '') {
      profile.displayName = displayName.picked.trim()
    }
    const baseURL = await app.askDialog({ title: strings().addProviderBaseUrlPrompt, options: [] })
    if (baseURL.reason === 'picked' && baseURL.picked !== undefined && baseURL.picked.trim() !== '') {
      profile.baseURL = baseURL.picked.trim()
    }
    const protocol = await app.askDialog({
      title: strings().addProviderProtocolPrompt,
      options: ['openai-completions', 'openai-responses', 'anthropic-messages', strings().cancel],
    })
    if (protocol.reason === 'picked' && protocol.picked !== undefined && protocol.picked !== strings().cancel) {
      profile.api = protocol.picked
    }
    const keyEnv = await app.askDialog({ title: strings().addProviderKeyEnvPrompt, options: [] })
    if (keyEnv.reason === 'picked' && keyEnv.picked !== undefined && keyEnv.picked.trim() !== '') {
      profile.apiKeyEnv = keyEnv.picked.trim()
    }
    try {
      await settings.update(namespace, { providers: { [route]: profile } })
      app.toast(strings().providerSaved(route), 'success')
    } catch (error: unknown) {
      app.toast(strings().providerSaveFailed(error instanceof Error ? error.message : String(error)), 'error')
    }
  }

  // ---- 插件 session 投影（K3）：sessionProjections 注册表的结构化读取。
  // 凡符合 select 形态（options/currentValue）的投影自动成为可交互行：
  // 空闲状态行渲染为 chips，Ctrl+P 打开枚举 picker；写路径优先走同名
  // 注册命令（permissions 由权限预设服务特例处理，保留 full-access 确认）。

  /** sessionProjections 注册表的读面（out-of-tree 无 dsh-session-projection 依赖）。 */
  interface ProjectionsSeam {
    onChanged?: (listener: (session: Session, key: string, value: unknown, seq: number) => void) => (() => void)
    snapshot?: (session: Session) => { asOfSeq: number; values: Record<string, unknown> }
  }

  /** 投影值的 select 形态（options 数组 + currentValue）。 */
  interface ProjectionSelectSeam {
    options: Array<{ value: string; name: string; description?: string }>
    currentValue: string
  }

  const projectionsSeam = (ctx as { get: (key: string) => unknown }).get('sessionProjections') as ProjectionsSeam | undefined

  const isSelectProjection = (value: unknown): value is ProjectionSelectSeam => {
    if (typeof value !== 'object' || value === null) return false
    const candidate = value as Record<string, unknown>
    return Array.isArray(candidate.options)
      && candidate.options.every(option => typeof option === 'object' && option !== null
        && typeof (option as Record<string, unknown>).value === 'string'
        && typeof (option as Record<string, unknown>).name === 'string')
      && typeof candidate.currentValue === 'string'
  }

  /** 从当前会话的投影快照刷新 select 形态的交互行。 */
  const refreshProjections = (): void => {
    const agent = handle?.agent
    if (projectionsSeam?.snapshot === undefined || agent === undefined) return
    const snapshot = projectionsSeam.snapshot(agent.session)
    const rows: ProjectionRow[] = []
    for (const [key, value] of Object.entries(snapshot.values)) {
      // G42: token-meter 的结构化 contextBreakdown 投影（非 select 形态）
      // 直接进 footer 的三段彩条，不进交互行。
      if (key === 'contextBreakdown') {
        const breakdown = value as { systemTokens?: number; toolsTokens?: number; messageTokens?: number } | undefined
        if (breakdown !== undefined
          && typeof breakdown.systemTokens === 'number'
          && typeof breakdown.toolsTokens === 'number'
          && typeof breakdown.messageTokens === 'number') {
          meta.contextBreakdown = {
            systemTokens: breakdown.systemTokens,
            toolsTokens: breakdown.toolsTokens,
            messageTokens: breakdown.messageTokens,
          }
        }
        continue
      }
      if (!isSelectProjection(value)) continue
      rows.push({
        key,
        currentValue: value.currentValue,
        options: value.options.map(option => ({
          value: option.value,
          name: option.name,
          ...option.description === undefined ? {} : { description: option.description },
        })),
      })
    }
    projections = rows
    app.setProjections(rows)
  }

  /** 多个 select 投影时先选投影（Ctrl+P 的第一级选择）。 */
  const pickProjection = (rows: readonly ProjectionRow[]): Promise<ProjectionRow | null> =>
    new Promise((resolve) => {
      app.showQueuePicker(rows.map(row => ({
        value: row.key,
        label: row.key === 'permissions' ? strings().permission : row.key,
        description: row.options.find(option => option.value === row.currentValue)?.name,
      })), (value) => {
        resolve(value === null ? null : rows.find(row => row.key === value) ?? null)
      }, strings().permission)
    })

  /** 通用投影枚举 picker + 写路径（同名命令 / permissions 特例）。 */
  const openProjectionPicker = async (rows: readonly ProjectionRow[]): Promise<void> => {
    const agent = handle?.agent
    if (agent === undefined) return
    const row = rows.length === 1 ? rows[0] : await pickProjection(rows)
    if (row === undefined || row === null) return
    // permissions 投影直接复用权限预设 picker（含 full-access 确认）；
    // 显示名与 web PermissionSelect 同口径。
    if (row.key === 'permissions') {
      if (!quitting) {
        app.showPermissionPicker(row.options.map(option => ({
          value: option.value,
          label: permissionDisplayName(option.name),
          description: option.description,
          current: option.value === row.currentValue,
        })))
      }
      return
    }
    const picked = await new Promise<string | null>((resolve) => {
      app.showQueuePicker(row.options.map(option => ({
        value: option.value,
        label: option.name,
        description: option.description,
        current: option.value === row.currentValue,
      })), (value) => { resolve(value) }, row.key)
    })
    if (picked === null || picked === row.currentValue) return
    const commands = ctx.get('commands')
    const descriptor = commands?.list(agent).find(item => item.name === row.key)
    if (commands === undefined || descriptor === undefined) {
      app.toast(strings().projectionUnwritable(row.key), 'error')
      return
    }
    void commands.execute(agent, `/${row.key} ${picked}`, [], new AbortController().signal).then((execution) => {
      const result = execution?.result
      const text = result === undefined || result.text === undefined || result.text === ''
        ? `/${row.key} ${picked} 已执行`
        : result.text
      if (result?.kind === 'error') {
        doc = { ...doc, entries: [...doc.entries, {
          kind: 'notice' as const, id: `notice:cmd:${cmdSeq++}`,
          text, tone: 'error' as const,
        }] }
      } else {
        app.toast(text, 'success')
      }
      app.render(doc)
    }).catch((error: unknown) => { fail(exit, error) })
  }

  /** 校验并切换工作区（Ctrl+W 与 /workspace 共用）：目录校验 → 状态同步 → 新会话。 */
  const applyWorkspacePath = async (path: string): Promise<void> => {
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
    await swap(undefined)
  }

  /** A14: /workspace open 的路径解析（绝对/相对/`~`/file:// URI）。 */
  const resolveWorkspaceTarget = (target: string): string => {
    let path = target
    if (path.startsWith('file://')) {
      const rest = path.slice('file://'.length)
      path = decodeURIComponent(rest.startsWith('localhost/') ? rest.slice('localhost'.length) : rest)
    } else if (path.startsWith('~/')) {
      path = join(homedir(), path.slice(2))
    } else if (path === '~') {
      path = homedir()
    }
    return resolve(path)
  }

  /** A14: /workspace rename（复用 /rename workspace 的单段名校验 + fs.rename）。 */
  const renameWorkspaceDir = async (): Promise<void> => {
    const answer = await app.askDialog({ title: strings().wsRenamePrompt, options: [] })
    if (answer.reason !== 'picked' || answer.picked === undefined) return
    const newName = answer.picked.trim()
    if (newName === '') return
    if (newName.includes('/') || newName.includes('\\') || newName === '.' || newName === '..') {
      app.toast(strings().wsRenameInvalid, 'error')
      return
    }
    const current = resolve(workspaceRef.current ?? config.workspace ?? '.')
    const next = resolve(dirname(current), newName)
    if (next === current) return
    try {
      renameSync(current, next)
      workspaceRef.current = next
      meta.workspace = next
      app.setWorkspace(next)
      app.toast(strings().wsRenamed(next), 'success')
    } catch (error) {
      app.toast(strings().wsRenameFailed(error instanceof Error ? error.message : String(error)), 'error')
    }
  }

  /** /plugins 能力清单（M3，H20/H21 代理视图：命令/技能/投影三区）。 */
  const openPlugins = async (): Promise<void> => {
    const agent = handle?.agent
    const rows: PluginsRow[] = []
    const commandsService = ctx.get('commands') as { list: (agent: unknown) => Array<{ name: string; description: string }> } | undefined
    const commands = agent === undefined ? [] : commandsService?.list(agent) ?? []
    rows.push({ kind: 'header', title: strings().pluginsCommands(commands.length) })
    for (const command of commands) {
      rows.push({ kind: 'item', action: `command:${command.name}`, label: `/${command.name}`, detail: command.description })
    }
    const skills = agent === undefined ? [] : await Promise.resolve(skillsService()?.list() ?? []).catch(() => [])
    rows.push({ kind: 'header', title: strings().pluginsSkills(skills.length) })
    for (const skill of skills as Array<{ name?: string; description?: string; invocation?: { userInvocable?: boolean } }>) {
      if (typeof skill.name !== 'string' || skill.name === '') continue
      const invocable = skill.invocation?.userInvocable !== false
      rows.push({
        kind: 'item',
        action: `skill:${skill.name}`,
        label: `/${skill.name}`,
        detail: invocable ? strings().pluginsSkillHint : `— · ${skill.description ?? ''}`.replace(/ · $/, ''),
        tone: invocable ? undefined : 'muted',
      })
    }
    const snapshot = agent === undefined ? undefined : projectionsSeam?.snapshot?.(agent.session)
    const projectionKeys = Object.keys(snapshot?.values ?? {})
    rows.push({ kind: 'header', title: strings().pluginsProjections(projectionKeys.length) })
    for (const key of projectionKeys) {
      const value = snapshot?.values[key]
      if (isSelectProjection(value)) {
        rows.push({ kind: 'item', action: `projection:${key}`, label: key,
          detail: key === 'permissions' ? permissionDisplayName(value.currentValue) : value.currentValue, tone: 'accent' })
      } else {
        rows.push({ kind: 'item', action: `projection:${key}`, label: key, detail: strings().pluginsStructured, tone: 'muted' })
      }
    }
    app.showPlugins(rows)
  }

  /** /workspace：最近使用的工作目录列表（sessionQuery cwd 去重），选中即切换。 */
  const openWorkspace = (): void => {
    const query = ctx.get('sessionQuery')
    if (query === undefined) return
    void query.listSessions().then((records) => {
      const current = resolve(workspaceRef.current ?? config.workspace ?? '.')
      const byCwd = new Map<string, { at: number; count: number }>()
      for (const record of records as Array<{ header: { cwd?: string; createdAt: number } }>) {
        const cwd = record.header.cwd
        if (cwd === undefined) continue
        const entry = byCwd.get(cwd)
        if (entry === undefined) byCwd.set(cwd, { at: record.header.createdAt, count: 1 })
        else {
          entry.at = Math.max(entry.at, record.header.createdAt)
          entry.count += 1
        }
      }
      const items = [...byCwd.entries()]
        .sort((left, right) => right[1].at - left[1].at)
        .map(([cwd, info]) => ({
          value: cwd,
          label: cwd === current ? `${cwd} ${strings().workspaceCurrent}` : cwd,
          description: strings().workspaceSessions(info.count),
        }))
      app.showQueuePicker(items, (value) => {
        if (value !== null) void applyWorkspacePath(value).catch((error: unknown) => { fail(exit, error) })
      }, strings().workspaceTitle)
    }).catch((error: unknown) => { fail(exit, error) })
  }

  /**
   * 空闲窗口内逐个回填未缓存会话的标题。readTitle 对已持久化会话整读
   * 日志（主线程解压解析），串行 + 用户按键时暂停：面板打开立即响应，
   * 上下切换不卡；标题解析一个就写回缓存并就地刷新一行。
   */
  const fillTitlesLazily = async (
    query: { readTitle: (id: SessionId) => Promise<{ title?: string } | undefined> },
    records: ReadonlyArray<{ header: { id: SessionId; parentSession?: SessionId } }>,
    items: Array<{ value: string; label: string; description: string }>,
    cache: Record<string, TitleCacheEntry>,
  ): Promise<void> => {
    const pending = records
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => record.header.id !== currentSessionId && cache[record.header.id] === undefined)
    while (pending.length > 0 && !quitting && !pickerClosed && !pickerFiltered) {
      const idle = internals.pickerTitleIdleMs - (Date.now() - pickerActivityAt)
      if (idle > 0) await new Promise(resolve => setTimeout(resolve, idle))
      if (quitting || pickerClosed || pickerFiltered) return
      // 用户仍在操作（上下键/输入）：再等一轮，按键渲染优先于整读。
      if (Date.now() - pickerActivityAt < internals.pickerTitleIdleMs) continue
      const head = pending.shift()
      if (head === undefined) return
      const { record, index } = head
      const title = await query.readTitle(record.header.id).catch(() => undefined)
      if (quitting || pickerClosed) return
      const resolved = title?.title
      if (resolved !== undefined && resolved !== '') {
        items[index] = {
          ...items[index],
          label: `${record.header.parentSession === undefined ? '' : '↳ '}${resolved}`,
        }
        cache[record.header.id] = { title: resolved, at: Date.now() }
        persistTitleCache(cache)
        if (!pickerFiltered) app.setSessionPickerRows(items)
      }
      // 让出事件循环：按键/渲染先于下一次整读。
      await new Promise(resolve => setTimeout(resolve, 0))
    }
  }

  /**
   * 启动时后台标题回填（跨版本恢复标题缓存）：升级后首次运行缓存为空，
   * 老会话在 picker 里只能等空闲补名；这里在全局空闲（无按键、非 busy）
   * 时串行逐个 readTitle 写缓存，每次启动限量（titleBackfillCap）避免
   * 大日志整读占用过多主线程；读满后 toast 汇报，quit 立即终止。
   */
  const backfillTitleCache = async (
    query: {
      listSessions: (signal?: AbortSignal) => Promise<ReadonlyArray<{ header: { id: SessionId } }>>
      readTitle: (id: SessionId) => Promise<{ title?: string } | undefined>
    },
  ): Promise<void> => {
    const records = await query.listSessions().catch(() => undefined)
    if (records === undefined || quitting) return
    const cache = loadTitleCache()
    const pending = records
      .map(record => record.header.id)
      .filter(id => id !== currentSessionId && cache[id] === undefined)
    let filled = 0
    while (pending.length > 0 && filled < internals.titleBackfillCap && !quitting) {
      if (doc.busy) {
        await new Promise(resolve => setTimeout(resolve, internals.pickerTitleIdleMs))
        continue
      }
      const idle = internals.pickerTitleIdleMs - (Date.now() - lastUserActivityAt)
      if (idle > 0) await new Promise(resolve => setTimeout(resolve, idle))
      if (quitting) return
      if (Date.now() - lastUserActivityAt < internals.pickerTitleIdleMs || doc.busy) continue
      const id = pending.shift()
      if (id === undefined) return
      const title = await query.readTitle(id).catch(() => undefined)
      if (quitting) return
      const resolved = title?.title
      if (resolved !== undefined && resolved !== '') {
        cache[id] = { title: resolved, at: Date.now() }
        persistTitleCache(cache)
        filled++
      }
      // 让出事件循环：按键/渲染先于下一次整读。
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    if (filled > 0 && !quitting) app.toast(strings().titlesBackfilled(filled), 'info')
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
          app.notifyQueue(queue.length, queue)
        }
        return
      }
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }))
    },
    onInterrupt: (): void => {
      // B6: Esc/Ctrl+C 中断——排队消息在回合落定后由 drain 自动重投（followup），
      // 这里给一条反馈，避免用户以为队列丢了。
      if (queue.length > 0) app.toast(strings().pendingReposted(queue.length), 'info')
      handle?.agent.cancel({ kind: 'user' })
    },
    onInterruptSend: (text: string): void => {
      if (quitting || handle === undefined) return
      if (doc.readOnlyHint !== undefined) {
        // E10: 只读的一次性子代理会话同样拒绝打断投递。
        app.toast('🔒 一次性子代理会话为只读，无法发送消息', 'error')
        return
      }
      // B5: Ctrl+Enter = 打断当前回合并立即投递（CC 三态投递）。busy 时先 cancel：
      // harness 的 cancel-convergence 语义保证 cancel 后提交的输入排队到下一回合、
      // 在 abort 收敛到 idle 后运行（见 dsh-agent runtime-types send 注释）。
      if (doc.busy) handle.agent.cancel({ kind: 'user' })
      handle.agent.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }))
    },
    onCycleModeRequest: (): void => {
      // B8: Shift+Tab 循环会话模式（默认 → 计划 → 完全访问）。plan 平面走
      // /plan on|off 命令通道；sandbox 平面复用 switchPreset（full 档保留确认，
      // 取消则整档放弃、模式不前进）。plan 平面以 currentModeId 为真相
      // （doc.planMode 随事件异步更新，循环判断不能依赖它）。
      const next = nextSessionMode(currentModeId)
      const current = DEFAULT_SESSION_MODES.find(mode => mode.id === currentModeId)
      void (async () => {
        if (quitting || handle === undefined) return
        if (next.sandbox !== undefined) {
          const presets = ctx.get('permissionPresets')
          const currentPreset = presets?.current(handle.agent.session.events)
          if (currentPreset !== next.sandbox) {
            const applied = await switchPreset(next.sandbox)
            if (!applied) return // 确认取消：停留在当前档
          }
        }
        if (next.plan !== undefined && next.plan !== current?.plan) {
          const commands = ctx.get('commands')
          if (commands !== undefined) {
            await commands.execute(handle.agent, next.plan ? '/plan on' : '/plan off', [], new AbortController().signal).catch(() => {})
          }
        }
        currentModeId = next.id
        const modeLabel = next.id === 'plan' ? strings().modePlan
          : next.id === 'full' ? strings().modeFull
          : strings().modeDefault
        app.toast(strings().sessionModeSwitched(modeLabel), 'success')
      })().catch((error: unknown) => { fail(exit, error) })
    },
    onQuit: (): void => {
      if (quitting) return
      quitting = true
      void quit().catch((error: unknown) => { fail(exit, error) })
    },
    onSessionPicked: (value: string | null): void => {
      pickerClosed = true
      if (value === null || value === currentSessionId) return
      touchMru(value)
      void swap(value).then(() => {
        // CC-09: 切换成功的即时反馈（picker 只标记当前行，切换后无 banner）。
        app.toast(strings().resumedSession(meta.session), 'info')
      }).catch((error: unknown) => { fail(exit, error) })
    },
    onModelPicked: (value: string | null): void => {
      if (value === null) return
      // Model and reasoning effort are chosen independently: picking a model
      // keeps the current effort; `/effort` switches it separately (T7).
      applyModelPick(value)
    },
    onSessionPickerRequest: (): void => {
      const query = ctx.get('sessionQuery')
      if (query === undefined) return
      pickerFiltered = false
      pickerClosed = false
      pickerActivityAt = Date.now()
      // D2: 打开即视当前会话为最近使用（排序优先级提升）。
      touchMru(currentSessionId)
      void query.listSessions().then(async (records) => {
        // 面板立即可用：标题先查自家缓存（会话切换/退出/重命名时写入），
        // 命中直接显示名称；未命中用短 id 占位，空闲时逐个回填。平台侧
        // readTitle 对每个已持久化会话整读日志（大日志一次 0.5s+ 主线程
        // 解压解析），几百个会话无上限并发直接卡死面板交互（E2E 库 297
        // 会话实测 15s+ 不返回），故只允许空闲时串行读。
        const cache = loadTitleCache()
        const shortId = (id: string): string => (id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id)
        const labelOf = (record: { header: { id: string; parentSession?: string } }, title: string | undefined): string =>
          `${record.header.parentSession === undefined ? '' : '↳ '}${title ?? shortId(record.header.id)}`
        const mru = loadMru()
        // D2: 最近使用优先（稳定排序，MRU 外保持 listSessions 顺序）；
        // 先排 records 再 map，fillTitlesLazily 的索引仍与记录对齐。
        const ordered = [...records].sort(
          (left, right) => (mru[right.header.id] ?? 0) - (mru[left.header.id] ?? 0),
        )
        // D1 轻量子集：子会话计数（仅 header 字段，不深读日志）。
        const childCount = new Map<string, number>()
        for (const record of ordered) {
          const parent = record.header.parentSession as string | undefined
          if (parent !== undefined) childCount.set(parent, (childCount.get(parent) ?? 0) + 1)
        }
        const items = ordered.map(record => ({
          value: record.header.id,
          label: labelOf(record, record.header.id === currentSessionId ? doc.title : cache[record.header.id]?.title),
          description: [
            `${record.persisted ? 'persisted' : 'live'} · ${relTime(record.header.createdAt)}`,
            ...(record.header.agentPreset === undefined ? [] : [strings().sessionPreset(String(record.header.agentPreset))]),
            ...(childCount.has(record.header.id) ? [strings().sessionChildren(childCount.get(record.header.id) ?? 0)] : []),
          ].join(' · '),
        }))
        if (!quitting) app.showSessionPicker(items)
        void fillTitlesLazily(query, ordered, items, cache)
      }).catch((error: unknown) => {
        process.stderr.write(`dsh tui: session listing failed: ${error instanceof Error ? error.message : String(error)}\n`)
      })
    },
    onSessionPickerActivity: (): void => {
      pickerActivityAt = Date.now()
    },
    onUserActivity: (): void => {
      lastUserActivityAt = Date.now()
    },
    onSessionSearchRequest: (filter: string): void => {
      // H5: backend full-text session search merged into the open picker.
      pickerFiltered = true
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
        const arg = rawInput?.trim() ?? ''
        if (arg === 'zh' || arg === 'en') {
          applyLanguage(arg)
          return
        }
        void (async () => {
          const answer = await app.askDialog({ title: strings().chooseLanguage, options: ['中文', 'English'] })
          if (answer.reason !== 'picked' || answer.picked === undefined) return
          applyLanguage(answer.picked === 'English' ? 'en' : 'zh')
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
          // footer 状态栏即时显示所选 effort 的显示名。
          meta.effort = picked.name
          void defaultModel.saveSelection(next).catch(() => {})
          app.toast(`${strings().effort}：${picked.name}`, 'success')
          app.render(doc)
        })().catch((error: unknown) => { fail(exit, error) })
        return
      }
      if (name === '__model') {
        // `/model` bare opens the enum picker; `/model provider/model`
        // switches directly (validated against the live model listing).
        const args = rawInput?.trim() ?? ''
        if (args === '') {
          handlers.onModelPickerRequest?.()
          return
        }
        void (async () => {
          const choices = await listModelChoices()
          const match = choices.find(item => item.value === args)
          if (match === undefined) {
            doc = { ...doc, entries: [...doc.entries, {
              kind: 'notice' as const, id: `notice:cmd:${cmdSeq++}`,
              text: strings().unknownModel(args), tone: 'error' as const,
            }] }
            app.render(doc)
            return
          }
          if (applyModelPick(match.value)) {
            app.toast(strings().modelSwitched(match.value), 'success')
          }
        })().catch((error: unknown) => { fail(exit, error) })
        return
      }
      if (name === '__permission') {
        // `/permission` bare opens the enum picker; `/permission <preset>`
        // switches directly (full-access keeps the web confirmation).
        const presets = ctx.get('permissionPresets')
        if (presets === undefined || handle === undefined) return
        const args = rawInput?.trim() ?? ''
        if (args === '') {
          handlers.onPermissionPickerRequest?.()
          return
        }
        if (!presets.names.includes(args)) {
          doc = { ...doc, entries: [...doc.entries, {
            kind: 'notice' as const, id: `notice:cmd:${cmdSeq++}`,
            // 可用列表用显示名（与 picker 同口径）；用户输入原样回显便于对照。
            text: strings().unknownPreset(args, presets.names.map(permissionDisplayName).join(', ')), tone: 'error' as const,
          }] }
          app.render(doc)
          return
        }
        void switchPreset(args).catch((error: unknown) => { fail(exit, error) })
        return
      }
      if (name === '__config') {
        void configMenu().catch((error: unknown) => { fail(exit, error) })
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
        app.showHotkeys()
        return
      }
      if (name === '__tips') {
        app.showTips()
        return
      }
      if (name === '__thinking') {
        // A16: /thinking 弹 Enabled/Disabled 选择（Ctrl+T 同语义，不持久化）。
        const hidden = app.isThinkingHidden()
        void (async () => {
          const picked = await new Promise<string | null>((resolve) => {
            app.showQueuePicker([
              { value: 'enabled', label: strings().thinkingEnabled, current: !hidden },
              { value: 'disabled', label: strings().thinkingDisabled, current: hidden },
            ], resolve, strings().thinkingTitle)
          })
          if (picked === null) return
          app.setHideThinking(picked === 'disabled')
          app.toast(picked === 'disabled' ? strings().thinkingDisabled : strings().thinkingEnabled, 'info')
        })()
        return
      }
      if (name === '__activity') {
        // A15: /activity 弹帧预设选择；`frames <id>` 直切；持久化到 tui 命名空间。
        const arg = (rawInput ?? '').trim()
        const current = ((): FrameId => {
          const saved = tuiSettingsSection()?.activityFrames ?? ''
          return isFrameId(saved) ? saved : 'star'
        })()
        const applyActivity = (id: FrameId): void => {
          void settingsSeam()?.update?.('tui', { activityFrames: id }).catch(() => {})
          app.setActivityFrames(id)
          app.toast(strings().activityFrameSwitched(strings().activityFrameName(id)), 'success')
        }
        const framesMatch = /^frames\s+(\S+)$/.exec(arg)
        if (framesMatch !== null) {
          const id = framesMatch[1]
          if (isFrameId(id)) applyActivity(id)
          else app.toast(strings().activityFrameInvalid(id), 'error')
          return
        }
        if (arg !== '') {
          app.toast(strings().activityUsage, 'error')
          return
        }
        void (async () => {
          const picked = await new Promise<string | null>((resolve) => {
            app.showQueuePicker(FRAME_SETS.map(set => ({
              value: set.id,
              label: strings().activityFrameName(set.id),
              current: current === set.id,
            })), resolve, strings().activityTitle)
          })
          if (picked === null) return
          if (isFrameId(picked)) applyActivity(picked)
        })()
        return
      }
      if (name === '__btw') {
        // A12: 无工具单轮侧问——当前模型直调 llm.stream，流式进浮层；
        // 不写日志/不进文档流；busy 亦可触发不打断；再次触发中止上一个。
        const llm = ctx.get('llm') as { stream?: (options: unknown) => AsyncIterable<unknown> } | undefined
        if (llm?.stream === undefined) {
          app.toast(strings().btwUnavailable, 'error')
          return
        }
        const arg = (rawInput ?? '').trim()
        void (async () => {
          let question = arg
          if (question === '') {
            const answer = await app.askDialog({ title: strings().btwPrompt, options: [] })
            if (answer.reason !== 'picked' || answer.picked === undefined) return
            question = answer.picked.trim()
            if (question === '') return
          }
          btwController?.abort()
          const controller = new AbortController()
          btwController = controller
          app.openBtw(question)
          const [provider, ...modelParts] = meta.model.split('/')
          const model = modelParts.join('/')
          const streamFn = llm.stream
          if (streamFn === undefined) {
            app.toast(strings().btwUnavailable, 'error')
            return
          }
          try {
            const stream = streamFn({
              provider,
              model,
              messages: [{ role: 'user', content: [{ type: 'text', text: question }] }],
              signal: controller.signal,
            })
            for await (const chunk of stream) {
              const candidate = chunk as { type?: string; text?: string }
              if (candidate.type === 'text-delta' && typeof candidate.text === 'string') {
                app.appendBtw(candidate.text)
              }
            }
          } catch (error) {
            if (!controller.signal.aborted) {
              app.toast(strings().btwFailed(error instanceof Error ? error.message : String(error)), 'error')
            }
          } finally {
            if (btwController === controller) btwController = undefined
          }
        })()
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
        // B12: `/export md`（或 --md）导出 Markdown 分节文件（CC 语义）；
        // 无参保持 web 语义（展示 jsonl 路径 + flush）。
        const arg = (rawInput?.trim() ?? '').toLowerCase()
        const wantMd = arg === 'md' || arg === '--md'
        const cwd = resolve(workspaceRef.current ?? config.workspace ?? '.')
        void exportSessionLog(ctx, sessions, handle.agent.session, doc, wantMd ? 'md' : 'jsonl', cwd).then((next) => {
          doc = next
          app.render(doc)
        }).catch((error: unknown) => { process.stderr.write(`dsh tui: export failed: ${error instanceof Error ? error.message : String(error)}\n`) })
        return
      }
      if (name === '__rename') {
        // H7 + H11: 裸 /rename 弹「会话标题 / 工作区目录」目标选择；内联参数
        // 保持会话重命名的直切语义（向后兼容）。
        const arg = rawInput?.trim() ?? ''
        void (async () => {
          const askName = async (prompt: string): Promise<string | undefined> => {
            const answer = await app.askDialog({ title: prompt, options: [] })
            if (answer.reason !== 'picked' || answer.picked === undefined) return undefined
            const value = answer.picked.trim()
            return value === '' ? undefined : value
          }
          let target: 'session' | 'workspace' = 'session'
          if (arg === '') {
            const pick = await app.askDialog({
              title: strings().renameTarget,
              options: [strings().renameSession, strings().renameWorkspace],
            })
            if (pick.reason !== 'picked' || pick.picked === undefined) return
            target = pick.picked === strings().renameWorkspace ? 'workspace' : 'session'
          }
          if (target === 'workspace') {
            // H11/A14: 重命名当前工作区目录（单段名校验后 fs.rename）。
            await renameWorkspaceDir()
            return
          }
          // 会话标题（原语义）：sessionTitle.rename 固定标题，自动生成停止。
          let finalTitle = arg
          if (finalTitle === '') {
            const title = await askName(strings().renameSession)
            if (title === undefined) return
            finalTitle = title
          }
          const titleService = ctx.get('sessionTitle')
          if (titleService === undefined) {
            app.toast('会话重命名不可用（sessionTitle 服务未挂载）', 'error')
            return
          }
          try {
            const snapshot = (titleService as { rename: (session: unknown, title: string) => { title: string } })
              .rename(handle.agent.session, finalTitle)
            doc = { ...doc, title: snapshot.title }
            rememberCurrentTitle()
            app.render(doc)
            app.toast(`会话标题：${snapshot.title}`, 'success')
          } catch (error: unknown) {
            app.toast(`重命名失败：${error instanceof Error ? error.message : String(error)}`, 'error')
          }
        })()
        return
      }
      if (name === '__trajectory') {
        handlers.onTrajectoryRequest?.()
        return
      }
      if (name === '__keymap') {
        const arg = rawInput?.trim() ?? ''
        const apply = (id: KeymapId): void => {
          activeKeymap = id
          app.setKeymap(id)
          persistKeymap(id)
          app.toast(strings().keymapSwitched(id), 'success')
        }
        if (arg !== '') {
          if (isKeymapId(arg)) apply(arg)
          else app.toast(strings().keymapUnknown(arg, 'cc, pi, opencode'), 'error')
          return
        }
        void pickKeymap()
        return
      }
      if (name === '__theme') {
        const arg = rawInput?.trim() ?? ''
        if (arg !== '') {
          const custom = loadCustomThemes().find(theme => theme.name === arg)
          if (custom !== undefined) {
            applyCustomTheme(custom)
            return
          }
          if (isThemePresetId(arg)) applyThemePreset(arg)
          else app.toast(strings().themeUnknown(arg, 'web, cc, pi, opencode'), 'error')
          return
        }
        void pickTheme()
        return
      }
      if (name === '__settings') {
        void openSettings()
        return
      }
      if (name === '__plugins') {
        void openPlugins()
        return
      }
      if (name === '__workspace') {
        // A14: 子命令 resume/rename/open；无参带说明打开最近列表（保留便捷）。
        const workspaceUsageNotice = (): void => {
          doc = { ...doc, entries: [...doc.entries, {
            kind: 'notice' as const, id: `notice:ws-usage:${cmdSeq++}`,
            text: strings().workspaceUsage, tone: 'info' as const,
          }] }
          app.render(doc)
        }
        const arg = (rawInput ?? '').trim()
        const [sub, ...rest] = arg.split(/\s+/)
        const target = rest.join(' ').trim()
        if (sub === 'resume' || arg === '') {
          if (arg !== '') openWorkspace()
          else {
            workspaceUsageNotice()
            openWorkspace()
          }
          return
        }
        if (sub === 'rename') {
          void renameWorkspaceDir().catch((error: unknown) => { fail(exit, error) })
          return
        }
        if (sub === 'open') {
          if (target === '') {
            workspaceUsageNotice()
            return
          }
          void applyWorkspacePath(resolveWorkspaceTarget(target)).catch((error: unknown) => { fail(exit, error) })
          return
        }
        workspaceUsageNotice()
        return
      }
      if (name === '__resume') {
        // 会话选择器（启动 browse 与 Ctrl+R 同源入口）：列表 → 选中 → swap。
        handlers.onSessionPickerRequest?.()
        return
      }
      if (name === '__rewind') {
        // B7: 时间回溯（空输入双击 Esc 同入口）。
        handlers.onRewindRequest?.()
        return
      }
      // B13: CC 命令全集（状态/说明类）。报告经 notice + detail 展开体输出
      // （聚焦 + Enter 展开全文，与 E12 注入行同机制）。
      {
        const cwd = resolve(workspaceRef.current ?? config.workspace ?? '.')
        const note = (text: string, detail = '', tone: 'info' | 'error' = 'info'): void => {
          doc = { ...doc, entries: [...doc.entries, { kind: 'notice' as const, id: `notice:cmd:${cmdSeq++}`, text, detail, tone }] }
          app.render(doc)
        }
        if (name === '__status') {
          const stats = sessionStats(doc)
          const cacheHit = cacheHitPercent(stats)
          const billed = billedInputTokens(stats)
          const branch = gitBranch(cwd)
          const usage = meta.contextWindow !== undefined && meta.contextWindow > 0 && billed > 0
            ? `${Math.round(billed / meta.contextWindow * 100)}%`
            : '—'
          note(`状态 · ${meta.model}`, [
            `${strings().statusModel}：${meta.model}${meta.effort !== undefined ? ` · effort ${meta.effort}` : ''}`,
            `${strings().statusState}：${doc.busy ? strings().stateWorking : strings().stateIdle}`,
            `${strings().statusSession}：${meta.session}${meta.parentSession !== undefined ? `（父 ${meta.parentSession}）` : ''}`,
            `${strings().statusDirectory}：${cwd}${branch === '' ? '' : ` · ${branch}`}`,
            `${strings().statusTokens}：in ${formatTokens(billed)} · out ${formatTokens(stats.outputTokens)}`,
            cacheHit !== null ? `${strings().statusCacheHit}：${cacheHit}%` : '',
            `${strings().statusContextUsage}：${usage}`,
            doc.title !== undefined ? `${strings().statusTitle}：${doc.title}` : '',
          ].filter(line => line !== '').join('\n'))
          return
        }
        if (name === '__tokens' || name === '__cost') {
          const stats = sessionStats(doc)
          const cacheHit = cacheHitPercent(stats)
          const billed = billedInputTokens(stats)
          note(name === '__cost'
            ? `Token 用量 · ${formatTokens(billed)} in / ${formatTokens(stats.outputTokens)} out`
            : strings().tokensTitle, [
            `${strings().tokensInput}：${stats.inputTokens}`,
            `${strings().tokensCacheRead}：${stats.cacheReadTokens}`,
            `${strings().tokensCacheWrite}：${stats.cacheWriteTokens}`,
            `${strings().tokensOutput}：${stats.outputTokens}`,
            cacheHit !== null ? `${strings().statusCacheHit}：${cacheHit}%` : '',
          ].filter(line => line !== '').join('\n'))
          return
        }
        if (name === '__doctor') {
          void (async () => {
            const apiKey = process.env.DEEPSEEK_API_KEY
            const configPath = await settingsFilePath().catch(() => 'settings.yaml')
            note(strings().doctorTitle, [
            `${strings().statusModel}：${meta.model}`,
            `${strings().statusDirectory}：${cwd}`,
            `${strings().contextWindowLabel}：${meta.contextWindow ?? '—'}`,
            `${strings().doctorApiKey}：${apiKey === undefined ? strings().doctorApiKeyMissing : strings().doctorApiKeySet}`,
            `${strings().statusSession}：${meta.session}`,
            `${strings().doctorConfig}：${configPath}`,
            ].join('\n'))
            return
          })()
          return
        }
        if (name === '__init') {
          const target = join(cwd, 'AGENTS.md')
          if (existsSync(target)) {
            note(strings().initExists, '', 'error')
            return
          }
          try {
            writeFileSync(target, AGENTS_TEMPLATE, 'utf8')
            note(strings().initCreated(target))
          } catch (error) {
            note(`${strings().initExists}（写入失败：${error instanceof Error ? error.message : String(error)}）`, '', 'error')
          }
          return
        }
        if (name === '__agents') {
          const subs = doc.entries.filter(entry => entry.kind === 'notice' && entry.text.startsWith('◆ subagent'))
          if (subs.length === 0) {
            note(strings().agentsEmpty)
            return
          }
          note(`${strings().agentsTitle}（${subs.length}）`, subs.map(entry => (entry.kind === 'notice' ? entry.text : '')).join('\n'))
          return
        }
        if (name === '__skills') {
          void (async () => {
            const skills = skillsService()
            const rows = skills === undefined ? [] : await Promise.resolve(skills.list()).catch(() => [])
            if (rows.length === 0) {
              note(strings().skillsEmpty)
              return
            }
            note(`${strings().skillsTitle}（${rows.length}）`, (rows as Array<{ name?: string; description?: string }>)
              .map(skill => skill?.name === undefined ? '' : `${skill.name}${skill.description !== undefined ? ` — ${skill.description}` : ''}`)
              .filter(line => line !== '').join('\n'))
          })()
          return
        }
        if (name === '__context') {
          const report = contextReport(doc)
          note(report.title, report.body)
          return
        }
        // 说明类命令：占位/策略说明（远程同名命令的终端等价）。
        if (name === '__mcp') { note(strings().noteMcp); return }
        if (name === '__permissions') { note(strings().notePermissions); return }
        if (name === '__login') { note(strings().noteLogin); return }
        if (name === '__logout') { note(strings().noteLogout); return }
        if (name === '__add-dir') { note(strings().noteAddDir); return }
        if (name === '__hooks') { note(strings().noteHooks); return }
        if (name === '__vim') { note(strings().noteVim); return }
        if (name === '__terminal-setup') { note(strings().noteTerminalSetup); return }
        if (name === '__connect') { note(strings().noteConnect); return }
      }
      if (name === '__preset') {
        // 一键预设：键位 + 视觉主题同时切换（cc/pi/opencode 三档；web 主题
        // 只在 /theme 单切，因为 web 没有对应键位风格）。
        const arg = rawInput?.trim() ?? ''
        const applyProfile = (id: KeymapId): void => {
          activeKeymap = id
          app.setKeymap(id)
          persistKeymap(id)
          activeThemePreset = id
          persistThemePreset(id)
          applyPalette(id, themeVariant)
          app.refreshTheme()
          app.toast(strings().profileSwitched(id), 'success')
        }
        if (arg !== '') {
          if (isKeymapId(arg)) applyProfile(arg)
          else app.toast(strings().profileUnknown(arg, 'cc, pi, opencode'), 'error')
          return
        }
        void (async () => {
          const picked = await new Promise<string | null>((resolve) => {
            app.showQueuePicker(KEYMAPS.map(keymap => ({
              value: keymap.id,
              label: keymap.label,
              current: keymap.id === activeKeymap,
            })), resolve, strings().profileTitle)
          })
          if (picked === null || !isKeymapId(picked)) return
          applyProfile(picked)
        })()
        return
      }
      if (name === '__compose') {
        void app.composeInEditor()
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
            app.notifyQueue(queue.length, queue)
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
        const execution = await commands.execute(agent, `/${name} ${args}`.trimEnd(), [], new AbortController().signal)
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
      void commands.execute(agent, '/plan off', [], new AbortController().signal).catch(() => {})
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
        // B12：local 命令 echo 单行 + 完整输出进 detail（Enter 展开缩进 dim）。
        text: `⚙ local ${firstLine.replace(/^\$\s*/, '')} · ${lines} 行输出（未发送给模型）`,
        detail: text,
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
      app.notifyQueue(queue.length, queue)
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
    // B7: /rewind 与空输入双击 Esc——列出用户消息（newest-first），选中即回退。
    onRewindRequest: (): void => {
      if (handle === undefined) return
      const points = doc.entries
        .filter((entry): entry is Extract<typeof entry, { kind: 'user' }> => entry.kind === 'user')
        .map((entry) => {
          const seq = entry.seq ?? Number(entry.id.slice(1))
          const preview = entry.text.split('\n')[0] ?? ''
          return {
            value: String(seq),
            label: preview.length <= 40 ? preview : `${preview.slice(0, 39)}…`,
            description: `user · seq ${seq}`,
          }
        })
      if (points.length === 0) {
        void app.askDialog({ title: strings().rewindEmpty, options: ['好'] }).then(() => {})
        return
      }
      if (!quitting) app.showRewindPicker(points)
    },
    onRewindPicked: (seq: number | null): void => {
      if (seq === null || handle === undefined) return
      const entry = doc.entries.find(item => item.kind === 'user' && (item.seq ?? Number(item.id.slice(1))) === seq)
      const text = entry?.kind === 'user' ? entry.text : ''
      void rewindTo(handle.agent.session, seq, text).catch((error: unknown) => { fail(exit, error) })
    },
    // B11/H31: 把当前会话的原始事件日志窗口化成轨迹视图（Inspect）。
    onTrajectoryRequest: (): void => {
      if (handle === undefined) return
      const rows: TrajectoryRow[] = handle.agent.session.events.map(event => ({
        seq: event.seq,
        type: event.type,
        at: event.time,
        summary: trajectorySummary(event),
      }))
      app.showTrajectory(rows)
    },
    // opencode 预设的 <leader>t：打开主题预设 picker。
    onThemePickerRequest: (): void => {
      void pickTheme()
    },
    // /settings 面板行选中：数字直选或 Enter。
    onSettingsRowPicked: (index: number): void => {
      void (async () => {
        const refresh = async (): Promise<void> => { app.showSettings(await settingsRows()) }
        switch (index) {
          case 0: // 语言
            handlers.onCommandPicked('__lang', '')
            break
          case 1: // 主题（四选；切换后面板就地重绘新预设风格）
            if (await pickTheme()) await refresh()
            break
          case 2: { // Enter 行为（queue/steer，settings seam 持久化到 settings.yaml）
            const steerNow = effectiveEnterBehavior() === 'steer'
            const picked = await new Promise<string | null>((resolve) => {
              app.showQueuePicker([
                { value: 'queue', label: strings().enterQueue, current: !steerNow },
                { value: 'steer', label: strings().enterSteer, current: steerNow },
              ], resolve, strings().settingsEnter)
            })
            if (picked === null) return
            applyEnterBehavior(picked === 'steer')
            await refresh()
            break
          }
          case 3: // 键位（三选）
            if (await pickKeymap()) await refresh()
            break
          case 4: { // 动画（运行时切 animFrameMs + 持久化到 settings.yaml）
            const off = piTuiInternals.animFrameMs > 0
            applyAnim(off)
            await refresh()
            break
          }
          case 5: { // F3/V8: footer 档位（full/compact/minimal）
            const picked = await new Promise<string | null>((resolve) => {
              app.showQueuePicker([
                { value: 'full', label: strings().footerFull, current: footerMode() === 'full' },
                { value: 'compact', label: strings().footerCompact, current: footerMode() === 'compact' },
                { value: 'minimal', label: strings().footerMinimal, current: footerMode() === 'minimal' },
              ], resolve, strings().settingsFooter)
            })
            if (picked === null) return
            if (picked === 'full' || picked === 'compact' || picked === 'minimal') applyFooterMode(picked)
            await refresh()
            break
          }
          case 6: // 配置文件
            handlers.onCommandPicked('__config', '')
            break
          default:
            break
        }
      })()
    },
    // cc 语式：/settings 行上 ←/→ 直接循环切换值（广义交互层）。
    onSettingsRowCycle: (index: number, direction: 1 | -1): void => {
      void (async () => {
        const rows = await settingsRows()
        const cycle = rows[index]?.cycle
        if (cycle === undefined) return
        const pos = cycle.options.indexOf(cycle.current)
        const next = cycle.options[(pos + direction + cycle.options.length) % cycle.options.length] ?? cycle.current
        if (next === cycle.current) return
        switch (index) {
          case 0: // 语言
            applyLanguage(next === 'en' ? 'en' : 'zh')
            break
          case 1: // 主题
            if (isThemePresetId(next)) applyThemePreset(next)
            break
          case 2: // Enter 行为
            applyEnterBehavior(next === 'steer')
            break
          case 3: { // 键位
            if (isKeymapId(next)) {
              activeKeymap = next
              app.setKeymap(next)
              persistKeymap(next)
              app.toast(strings().keymapSwitched(next), 'success')
            }
            break
          }
          case 4: // 动画
            applyAnim(next === 'off')
            break
          case 5: { // F3/V8: footer 档位
            if (next === 'full' || next === 'compact' || next === 'minimal') applyFooterMode(next)
            break
          }
          default:
            break
        }
        app.showSettings(await settingsRows()) // 就地刷新行
      })().catch((error: unknown) => { fail(exit, error) })
    },
    // /plugins 面板条目：命令执行 / 技能插入 composer / 投影打开枚举 picker。
    onPluginsRowPicked: (action: string): void => {
      const separator = action.indexOf(':')
      const kind = action.slice(0, separator)
      const id = action.slice(separator + 1)
      if (kind === 'command') {
        handlers.onCommandPicked(id, '')
      } else if (kind === 'skill') {
        handlers.onCommandPicked(`${SKILL_COMMAND_PREFIX}${id}`, '')
      } else if (kind === 'projection') {
        const row = projections.find(entry => entry.key === id)
        if (row !== undefined) {
          void openProjectionPicker([row]).catch((error: unknown) => { fail(exit, error) })
        }
      }
    },
    onWorkspaceSwitchRequest: (): void => {
      if (quitting) return
      void (async () => {
        const answer = await app.askDialog({ title: '切换到工作目录（绝对路径）', options: [] })
        if (answer.reason !== 'picked' || answer.picked === undefined || answer.picked.trim() === '') return
        await applyWorkspacePath(resolve(answer.picked.trim()))
      })().catch((error: unknown) => { fail(exit, error) })
    },
    onPermissionPickerRequest: (): void => {
      // K3: 通用投影优先 —— select 形态的插件投影直接给出枚举 picker。
      if (projections.length > 0) {
        // cc 语式：permissions 投影存在时，Ctrl+P 行内循环到下一个预设
        // （Claude Code 权限模式循环精神），不弹选择器。
        const permissionsRow = projections.find(row => row.key === 'permissions')
        if (keymapById(activeKeymap).interaction.enum === 'inline-cycle' && permissionsRow !== undefined) {
          const pos = permissionsRow.options.findIndex(option => option.value === permissionsRow.currentValue)
          const next = permissionsRow.options[(pos + 1) % Math.max(1, permissionsRow.options.length)]
          if (next !== undefined && next.value !== permissionsRow.currentValue) {
            void switchPreset(next.value).catch((error: unknown) => { fail(exit, error) })
          }
          return
        }
        void openProjectionPicker(projections).catch((error: unknown) => { fail(exit, error) })
        return
      }
      // 回退：无投影注册表时沿用 permission-presets 服务的直连路径。
      const presets = ctx.get('permissionPresets')
      if (presets === undefined || handle === undefined) return
      const current = presets.current(handle.agent.session.events)
      const items = presets.names.map((name) => {
        const option = presets.optionOf(name)
        return { value: name, label: permissionDisplayName(option.name), description: option.description, current: name === current }
      })
      if (!quitting) app.showPermissionPicker(items)
    },
    onPermissionPicked: (value: string | null): void => {
      if (value === null) return
      void switchPreset(value).catch((error: unknown) => { fail(exit, error) })
    },
    onModelPickerRequest: (): void => {
      void listModelChoices().then((items) => {
        if (!quitting) app.showModelPicker(items)
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
  // 启动期后台标题回填（跨版本恢复缓存）：全局空闲时串行补名，不阻塞交互。
  if (internals.titleBackfillEnabled) {
    const query = ctx.get('sessionQuery')
    if (query !== undefined) void backfillTitleCache(query).catch(() => {})
  }
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
  // K3: 投影变更订阅 —— 注册表在每次事件提交后推送新值，刷新交互行。
  projectionsSeam?.onChanged?.((session) => {
    if (session.id !== currentSessionId) return
    refreshProjections()
  })
  if (config.browse === true) handlers.onSessionPickerRequest?.()
  // Interactive answerer seams for tool permissions and agent questions.
  // CC-02: 富化器把正在审批的工具调用（命令原文/影响文件）带进弹窗。
  installApprovals(
    ctx,
    { present: question => app.askDialog(question) },
    () => currentSessionId,
    120_000,
    { lookupToolCall: callId => approvalContext(findToolCall(doc.entries, callId)) },
  )

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
