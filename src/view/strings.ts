/**
 * Bilingual user-facing copy adopted from the dsh web client's locale tables
 * (packages/client/{locale,ui-conversation,ui-permission-presets,
 * ui-message-feedback,ui-model-selection}/src/client/locales*.ts): the web
 * wording is the project's authoritative phrasing, and the TUI reuses it
 * verbatim in both languages. Copy the web hardcodes outside its locale
 * tables (e.g. "Deep diving...") is NOT localized there, so the TUI keeps
 * it identical across languages too — it never gets a zh/en split.
 *
 * Views read through `strings()` at render time, so `/lang` or
 * `DSH_TUI_LANG=zh|en` (startup) switches the surface live.
 * @module dsh-tui-app/view/strings
 */

export type TuiLanguage = 'zh' | 'en'

/** The full copy surface; zh and en implement the same shape. */
export interface Strings {
  ok: string
  cancel: string
  copy: string
  copied: string
  retry: string
  loading: string
  loadFailed: string
  submit: string
  search: string
  expand: string
  collapse: string
  unknown: string
  truncated: string
  running: string
  diving: string
  durationSeconds: (seconds: number) => string
  durationMinutes: (minutes: number, seconds: string) => string
  stop: string
  send: string
  quit: string
  interrupt: string
  inputKept: string
  hotkeysTitle: string
  hotkeysDetail: string
  queued: (n: number) => string
  interrupted: string
  stopped: string
  compaction: string
  compactionRunning: string
  catalogMore: (n: number) => string
  relayFrom: (session: string) => string
  statsCounts: (turns: number, steps: number) => string
  statsTokens: (input: string, output: string) => string
  ttft: (seconds: string) => string
  statsLlm: (duration: string) => string
  statsToolCall: (duration: string) => string
  statsTtftAverage: (duration: string) => string
  statsTokensPerSecond: (throughput: string) => string
  statsCacheHit: (percent: number) => string
  feedbackLike: string
  feedbackDislike: string
  feedbackNote: string
  effort: string
  pickModel: string
  pickModelDescription: string
  permission: string
  permissionDescription: string
  fullAccessConfirmTitle: string
  fullAccessConfirmDescription: string
  fullAccessAcknowledge: string
  language: string
  chooseLanguage: string
  brandTagline: string
  backToBottom: string
  skipQuestion: string
  prevQuestion: string
  questionProgress: (index: number, total: number) => string
  pickHint: string
  multiPickHint: string
}

const zh: Strings = {
  // locale base (common namespace)
  ok: '确定',
  cancel: '取消',
  copy: '复制',
  copied: '复制成功',
  retry: '重试',
  loading: '加载中…',
  loadFailed: '加载失败',
  submit: '提交',
  search: '搜索',
  expand: '展开',
  collapse: '收起',
  unknown: '未知',
  truncated: '已截断',

  // ui-conversation
  running: '运行中…',
  // The web's turn-status line is hardcoded English (ChatView.tsx), not
  // localized: "Deep diving..." plus a clock after 15s. Reused verbatim.
  diving: 'Deep diving...',
  durationSeconds: (seconds: number): string => `${seconds}秒`,
  durationMinutes: (minutes: number, seconds: string): string => `${minutes}分${seconds}秒`,
  stop: '停止生成',
  send: '发送消息',
  quit: '退出',
  interrupt: '中断',
  inputKept: '输入将保留，回复后自动提交',
  hotkeysTitle: '快捷键',
  hotkeysDetail: [
    'Esc 中断 · Ctrl+C 退出 · Ctrl+/ 或 / 命令 · Ctrl+R 会话 · Ctrl+G 模型',
    'Ctrl+P 预设 · Ctrl+F 搜索 · Ctrl+B 分支 · Ctrl+Y 评价 · Ctrl+X 复制',
    'Ctrl+W 工作目录 · Ctrl+T thinking · Ctrl+K 折叠 · Ctrl+O jobs · Ctrl+E 退出 plan',
    'Ctrl+D 退出 · Tab/Esc 焦点循环 · Enter 展开 · PgUp/PgDn 滚动',
    '!命令 执行并发送 · !!命令 静默执行 · ↑/↓ 历史 · Ctrl+Z/Shift+Z 撤销重做',
  ].join('\n'),
  queued: (n: number): string => `${n} 条排队消息`,
  interrupted: '已中断',
  stopped: '已停止',
  compaction: '上下文已压缩',
  compactionRunning: '正在压缩…',
  catalogMore: (n: number): string => `…还有 ${n} 条`,
  relayFrom: (session: string): string => `来自会话 ${session}`,

  // stats line
  statsCounts: (turns: number, steps: number): string => `${turns} 轮 · ${steps} 步`,
  statsTokens: (input: string, output: string): string => `输入 ${input} tok · 输出 ${output} tok`,
  ttft: (seconds: string): string => `首 token ${seconds}`,
  // StatsLine strip (web verbatim, including the unlocalized K/M + m/s units)
  statsLlm: (duration: string): string => `LLM ${duration}`,
  statsToolCall: (duration: string): string => `工具调用 ${duration}`,
  statsTtftAverage: (duration: string): string => `首 token 平均 ${duration}`,
  statsTokensPerSecond: (throughput: string): string => `${throughput} tok/s`,
  statsCacheHit: (percent: number): string => `缓存命中 ${percent}%`,

  // ui-message-feedback
  feedbackLike: '好的回答',
  feedbackDislike: '有问题的回答',
  feedbackNote: '这条回答哪里好，或哪里有问题？（可选）',

  // ui-model-selection
  effort: '推理等级',
  pickModel: '选择模型',
  pickModelDescription: '选择本会话使用的模型',

  // ui-permission-presets
  permission: '权限',
  permissionDescription: '选择新会话的默认权限模式',
  fullAccessConfirmTitle: '确认启用 Full access？',
  fullAccessConfirmDescription:
    '启用 Full access 后，agent 将减少确认步骤，并且可以直接执行更多操作，包括敏感操作、文件修改或外部命令。仅建议在你信任当前任务时使用。',
  fullAccessAcknowledge: '我已了解风险，并愿意继续',

  // TUI-native (no web equivalent; bilingual for consistency)
  language: '语言',
  chooseLanguage: '选择语言',
  brandTagline: '探索未至之境！',
  backToBottom: '回到底部',
  // web ui-user-questions locale, verbatim
  skipQuestion: '跳过本题',
  prevQuestion: '上一题',
  questionProgress: (index, total) => `${index} / ${total}`,
  pickHint: '数字直选 · Enter 确认 · Esc 取消',
  multiPickHint: '数字/空格 多选 · Enter 确认 · Esc 取消',
}

const en: Strings = {
  // locale base (common namespace)
  ok: 'OK',
  cancel: 'Cancel',
  copy: 'Copy',
  copied: 'Copied',
  retry: 'Retry',
  loading: 'Loading…',
  loadFailed: 'Load failed',
  submit: 'Submit',
  search: 'Search',
  expand: 'Expand',
  collapse: 'Collapse',
  unknown: 'Unknown',
  truncated: 'Truncated',

  // ui-conversation
  running: 'Working…',
  diving: 'Deep diving...',
  durationSeconds: (seconds: number): string => `${seconds}s`,
  durationMinutes: (minutes: number, seconds: string): string => `${minutes}m ${seconds}s`,
  stop: 'Stop generating',
  send: 'Send message',
  quit: 'quit',
  interrupt: 'interrupt',
  inputKept: 'input is kept and sent when the reply ends',
  hotkeysTitle: 'Hotkeys',
  hotkeysDetail: [
    'Esc interrupt · Ctrl+C quit · Ctrl+/ or / commands · Ctrl+R sessions · Ctrl+G model',
    'Ctrl+P presets · Ctrl+F search · Ctrl+B fork · Ctrl+Y rate · Ctrl+X copy reply',
    'Ctrl+W workspace · Ctrl+T thinking · Ctrl+K fold · Ctrl+O jobs · Ctrl+E exit plan mode',
    'Ctrl+D quit · Tab/Esc focus cycle · Enter expand · PgUp/PgDn scroll',
    '!command run & send · !!command run silently · ↑/↓ history · Ctrl+Z/Shift+Z undo/redo',
  ].join('\n'),
  queued: (n: number): string => `${n} queued message${n === 1 ? '' : 's'}`,
  interrupted: 'Interrupted',
  stopped: 'Stopped',
  compaction: 'Context compacted',
  compactionRunning: 'Compacting…',
  catalogMore: (n: number): string => `…${n} more`,
  relayFrom: (session: string): string => `From session ${session}`,

  // stats line
  statsCounts: (turns: number, steps: number): string => `${turns} turns · ${steps} steps`,
  statsTokens: (input: string, output: string): string => `Input ${input} tok · Output ${output} tok`,
  ttft: (seconds: string): string => `First token ${seconds}`,
  // StatsLine strip (web verbatim, including the unlocalized K/M + m/s units)
  statsLlm: (duration: string): string => `LLM ${duration}`,
  statsToolCall: (duration: string): string => `Tool call ${duration}`,
  statsTtftAverage: (duration: string): string => `TTFT avg ${duration}`,
  statsTokensPerSecond: (throughput: string): string => `${throughput} tok/s`,
  statsCacheHit: (percent: number): string => `Cache hit ${percent}%`,

  // ui-message-feedback
  feedbackLike: 'Good response',
  feedbackDislike: 'Bad response',
  feedbackNote: 'What was good, or what went wrong? (optional)',

  // ui-model-selection
  effort: 'Effort',
  pickModel: 'Select model',
  pickModelDescription: 'Select the model for this conversation',

  // ui-permission-presets
  permission: 'Permission',
  permissionDescription: 'Choose the default permission mode for new sessions',
  fullAccessConfirmTitle: 'Enable Full access?',
  fullAccessConfirmDescription:
    'Full access lets new sessions reduce confirmation steps and perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust subsequent tasks.',
  fullAccessAcknowledge: 'I understand the risks and want to continue',

  // TUI-native
  language: 'Language',
  chooseLanguage: 'Choose language',
  brandTagline: 'Explore the uncharted!',
  backToBottom: 'to bottom',
  // web ui-user-questions locale, verbatim
  skipQuestion: 'Skip this question',
  prevQuestion: 'Previous question',
  questionProgress: (index, total) => `${index} / ${total}`,
  pickHint: 'number to pick · Enter confirm · Esc cancel',
  multiPickHint: 'number/space multi-select · Enter confirm · Esc cancel',
}

let current: Strings = zh

/** The active dictionary; views read at render time (T9 i18n). */
export function strings(): Strings {
  return current
}

/** Switch the active language. */
export function setStrings(language: TuiLanguage): void {
  current = language === 'en' ? en : zh
}

/** Resolve the startup language: DSH_TUI_LANG wins, default zh. */
export function resolveLanguage(envValue: string | undefined): TuiLanguage {
  return envValue === 'en' ? 'en' : 'zh'
}
