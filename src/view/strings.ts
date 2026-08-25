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

/** 快捷键面板的一行：按键组合 + 动作说明。 */
export interface HotkeyRow {
  keys: string
  action: string
}

/** 快捷键面板的一个分组（/hotkeys）。 */
export interface HotkeySection {
  title: string
  rows: HotkeyRow[]
}

/** One /tips group: a heading plus free-form hint lines (A18). */
export interface TipGroup {
  title: string
  lines: string[]
}

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
  /** V2: fullscreen 消息归属标签（CC 语式，用户=You / 助手=Claude；zh/en 同英文不本地化）。 */
  youLabel: string
  claudeLabel: string
  durationSeconds: (seconds: number) => string
  durationMinutes: (minutes: number, seconds: string) => string
  stop: string
  send: string
  quit: string
  interrupt: string
  inputKept: string
  hotkeysTitle: string
  /** 分组 + 对齐列的快捷键面板数据（替代旧的单行拥挤文本）。 */
  hotkeysSections: readonly HotkeySection[]
  /** 面板底部提示行。 */
  hotkeysHint: string
  /** /tips 面板标题与底部提示行（A18）。 */
  tipsTitle: string
  tipsHint: string
  /** /tips 的分组内容（快捷键/命令/工作流/个性化/避坑）。 */
  tipGroups: readonly TipGroup[]
  /** B5 输入历史搜索弹层标题与空态。 */
  historyTitle: string
  historyEmpty: string
  /** 可展开 notice（注入行/本地输出）聚焦提示行。 */
  expandHint: string
  localHint: string
  /** B7 Shift+Up 消息选择模式进入提示。 */
  messagePickHint: string
  /** B6 搜索结果位置提示（第 N / 共 M 处）。 */
  searchHitPosition: (index: number, total: number) => string
  /** D1 /resume 行元数据：agent preset 与子会话计数。 */
  sessionPreset: (preset: string) => string
  sessionChildren: (count: number) => string
  /** D4 子会话折叠 toggle 行。 */
  sessionChildrenExpand: (count: number) => string
  sessionChildrenFold: string
  /** A16 /thinking 弹层标题与选项（Enabled/Disabled，不持久化）。 */
  thinkingTitle: string
  thinkingEnabled: string
  thinkingDisabled: string
  /** A12 /btw 侧问（浮层标题/提示/错误）。 */
  btwTitle: string
  btwHint: string
  btwPrompt: string
  btwUnavailable: string
  btwFailed: (message: string) => string
  /** A15 /activity 帧预设（标题/名称/用法/错误）。 */
  activityTitle: string
  activityFrameName: (id: string) => string
  activityFrameSwitched: (name: string) => string
  activityFrameInvalid: (id: string) => string
  activityUsage: string
  /** F1 自定义主题（选择器标签/切换提示）。 */
  themeCustomLabel: (name: string) => string
  themeCustomSwitched: (name: string) => string
  /** E1/F4 diff 布局（/settings 行与三档标签）。 */
  settingsDiffLayout: string
  diffAuto: string
  diffFull: string
  diffUnified: string
  /** B11 OSC tab 标题。 */
  tabTitleBase: (session: string) => string
  tabTitleIdle: string
  tabTitleNew: string
  queueFirst: (count: number, preview: string) => string
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
  modelSwitched: (value: string) => string
  unknownModel: (value: string) => string
  presetSwitched: (value: string) => string
  unknownPreset: (value: string, available: string) => string
  // /config（web ui-settings 的终端对应：路径/预览/编辑/供应商管理）
  configTitle: string
  configProviders: string
  configAddProvider: string
  configPreview: string
  configOpenEditor: string
  configCopyPath: string
  configPath: (path: string) => string
  configProvidersTitle: string
  configUnavailable: string
  addProviderTitle: string
  addProviderRoutePrompt: string
  addProviderRouteCustom: string
  addProviderNamePrompt: string
  addProviderBaseUrlPrompt: string
  addProviderProtocolPrompt: string
  addProviderKeyEnvPrompt: string
  providerSaved: (route: string) => string
  providerSaveFailed: (message: string) => string
  editorUnset: string
  // Warp 通知（OSC 777，事实标准：Warp/Ghostty/WezTerm 兼容）
  warpNotifyTitle: string
  warpTurnComplete: (summary: string) => string
  warpTurnFailed: (code: string) => string
  warpApproval: (tool: string) => string
  warpToolError: (name: string) => string
  // 插件 session 投影（K3）
  projectionUnwritable: (key: string) => string
  // 审批卡命令块（CC-02，Claude Code 权限弹窗语义）
  permissionCommand: string
  permissionImpact: (path: string) => string
  // 会话切换反馈（CC-09）
  resumedSession: (session: string) => string
  // 轨迹视图（B11/H31）
  trajectoryTitle: string
  trajectoryEvents: (n: number) => string
  trajectoryFilterHint: string
  // /compose（pi A3，$EDITOR 撰写消息）
  composePlaceholder: string
  composeEmpty: string
  composeFailed: (message: string) => string
  // /keymap（cc/pi 快捷键双预设）
  keymap: string
  keymapDescription: string
  keymapSwitched: (id: string) => string
  keymapUnknown: (value: string, available: string) => string
  /** pi 预设的快捷键面板（cc 面板见 hotkeysSections）。 */
  hotkeysSectionsPi: readonly HotkeySection[]
  /** opencode 预设的快捷键面板（leader 键体系）。 */
  hotkeysSectionsOpencode: readonly HotkeySection[]
  // /theme + /preset（视觉主题预设 + 一键双预设）
  themePreset: string
  themePresetDescription: string
  themeSwitched: (id: string) => string
  themeUnknown: (value: string, available: string) => string
  profileTitle: string
  profileSwitched: (id: string) => string
  profileUnknown: (value: string, available: string) => string
  // /settings 聚合面板（M2，行名/现状值/提示；全部经词典）
  settingsTitle: string
  settingsHint: string
  settingsCycleHint: string
  settingsLanguage: string
  settingsTheme: string
  settingsEnter: string
  settingsKeymap: string
  settingsAnim: string
  settingsConfig: string
  /** F3/V8 footer 档位（full/compact/minimal）。 */
  settingsFooter: string
  footerFull: string
  footerCompact: string
  footerMinimal: string
  themeVariantDark: string
  themeVariantLight: string
  themeVariantAuto: string
  enterQueue: string
  enterSteer: string
  enterSwitched: (mode: string) => string
  /** cc 预设双按退出：空输入首次 Ctrl+C/Ctrl+D 的提示（B3/B20）。 */
  pressAgainToExit: string
  /** cc 预设 Tab follow-up：busy 时排入当前回合之后（B4）。 */
  queuedFollowUp: string
  /** B6: 中断时排队消息将自动重投（drain 在回合落定后 followup）。 */
  pendingReposted: (n: number) => string
  /** B8: Shift+Tab 会话模式循环的档名与切换提示。 */
  modeDefault: string
  modePlan: string
  modeFull: string
  sessionModeSwitched: (mode: string) => string
  /** B11: plan-review 反馈输入行。 */
  reviewFeedback: string
  reviewFeedbackEmpty: string
  reviewApproveError: string
  /** B7: /rewind 时间回溯。 */
  rewindPickerTitle: string
  rewindNoTarget: string
  rewindEmpty: string
  rewindNotice: string
  /** B19: 退出时打印的恢复命令提示。 */
  resumeHint: string
  /** 任务 1: `[` 键导出转录到 scrollback 的提示。 */
  transcriptToScrollback: string
  transcriptEmpty: string
  /** regular 模式能力降级提示。 */
  searchUnavailableRegular: string
  animOn: string
  animOff: string
  animSwitched: (state: string) => string
  /** 启动时后台标题回填完成（跨版本恢复标题缓存）。 */
  titlesBackfilled: (n: number) => string
  // /plugins（H20/H21 代理视图）与 /workspace（M3/M4）
  pluginsTitle: string
  pluginsHint: string
  pluginsCommands: (n: number) => string
  pluginsSkills: (n: number) => string
  pluginsProjections: (n: number) => string
  pluginsSkillHint: string
  pluginsStructured: string
  // 斜杠菜单（广义交互层样式维度；替换原组件内硬编码/语言判断）
  slashNoMatch: string
  slashMore: (n: number) => string
  slashHint: string
  // opencode popup 语式专属：标题计数行 + 含面板入口的底栏提示
  slashPopupTitle: (n: number) => string
  slashPopupHint: string
  workspaceTitle: string
  workspaceCurrent: string
  workspaceUsage: string
  workspaceSessions: (n: number) => string
  // /rename（会话标题 + 工作区目录两种目标）
  renameSession: string
  renameWorkspace: string
  renameTarget: string
  wsRenamePrompt: string
  wsRenameInvalid: string
  wsRenamed: (path: string) => string
  wsRenameFailed: (message: string) => string
  language: string
  chooseLanguage: string
  brandTagline: string
  backToBottom: string
  /** B16: NewMessagesPill 的新消息计数。 */
  newMessages: (n: number) => string
  /** B13: CC 命令全集的状态类/说明类文案。 */
  statusModel: string
  statusState: string
  statusSession: string
  statusDirectory: string
  statusTokens: string
  statusCacheHit: string
  statusContextUsage: string
  statusTitle: string
  stateWorking: string
  stateIdle: string
  tokensTitle: string
  tokensInput: string
  tokensCacheRead: string
  tokensCacheWrite: string
  tokensOutput: string
  doctorTitle: string
  doctorApiKey: string
  doctorApiKeyMissing: string
  doctorApiKeySet: string
  doctorConfig: string
  contextWindowLabel: string
  initCreated: (path: string) => string
  initExists: string
  agentsTitle: string
  agentsEmpty: string
  skillsTitle: string
  skillsEmpty: string
  /** /context 报告（A3）：注入上下文的标题/空态。 */
  ctxTitle: string
  ctxEmpty: string
  noteMcp: string
  notePermissions: string
  noteLogin: string
  noteLogout: string
  noteAddDir: string
  noteHooks: string
  noteVim: string
  noteTerminalSetup: string
  noteConnect: string
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
  youLabel: 'You',
  claudeLabel: 'Claude',
  durationSeconds: (seconds: number): string => `${seconds}秒`,
  durationMinutes: (minutes: number, seconds: string): string => `${minutes}分${seconds}秒`,
  stop: '停止生成',
  send: '发送消息',
  quit: '退出',
  interrupt: '中断',
  inputKept: '输入将保留，回复后自动提交',
  hotkeysTitle: '快捷键',
  // 分组 + 对齐列：每行一个按键组合，避免旧版一长串 ` · ` 挤压截断。
  hotkeysSections: [
    {
      title: '输入',
      rows: [
        { keys: 'Enter', action: '发送 · 运行中并入当前轮（steer）' },
        { keys: 'Ctrl+Enter', action: '打断当前回合并发送' },
        { keys: 'Alt+Enter', action: '并入当前轮（steer）' },
        { keys: 'Alt+Up', action: '取回排队消息' },
        { keys: '↑/↓', action: '输入历史' },
        { keys: 'Ctrl+Z', action: '撤销' },
        { keys: 'Ctrl+Shift+Z', action: '重做' },
      ],
    },
    {
      title: '会话与模型',
      rows: [
        { keys: 'Ctrl+R', action: '会话列表' },
        { keys: 'Alt+R', action: '输入历史搜索' },
        { keys: 'Shift+Tab', action: '会话模式循环（默认/计划/完全访问）' },
        { keys: 'Ctrl+G', action: '选择模型' },
        { keys: 'Ctrl+P', action: '权限预设循环（行内切换）' },
        { keys: 'Ctrl+E', action: '退出 plan 模式' },
        { keys: 'Ctrl+W', action: '切换工作目录' },
        { keys: 'Ctrl+B', action: '分支新会话' },
      ],
    },
    {
      title: '消息与视图',
      rows: [
        { keys: 'Ctrl+F', action: '搜索' },
        { keys: '[', action: '导出转录到 scrollback（Cmd+F 搜索）' },
        { keys: 'Ctrl+Y', action: '评价回复' },
        { keys: 'Ctrl+X', action: '$EDITOR 编辑当前输入' },
        { keys: 'Ctrl+K', action: '折叠旧消息' },
        { keys: 'Ctrl+T', action: 'thinking 开关' },
        { keys: 'Ctrl+O', action: 'jobs 折叠/展开' },
        { keys: 'Ctrl+L', action: '轨迹（事件日志）' },
        { keys: 'PgUp/PgDn', action: '滚动' },
        { keys: 'Tab', action: '焦点循环 · 运行中 follow-up 入队' },
        { keys: 'Enter', action: '展开/收起（thinking/工具卡/长消息）' },
      ],
    },
    {
      title: '命令与退出',
      rows: [
        { keys: '/', action: 'slash 命令（如 /model、/permission、/config）' },
        { keys: 'Ctrl+/', action: '命令面板' },
        { keys: '! · !!', action: '执行 shell：发送 / 静默' },
        { keys: 'Esc · Ctrl+C', action: '中断当前轮（运行中）' },
        { keys: 'Ctrl+C', action: '清空输入 · 再按一次退出（空闲时）' },
        { keys: 'Ctrl+D', action: '再按一次退出' },
      ],
    },
  ],
  hotkeysHint: '↑/↓ 滚动 · PgUp/PgDn 翻页 · Esc 关闭',
  tipsTitle: '使用提示',
  tipsHint: '↑/↓ 滚动 · PgUp/PgDn 翻页 · Esc 关闭',
  historyTitle: '输入历史',
  historyEmpty: '暂无输入历史',
  expandHint: '注入内容 · ⏎ 展开/收起 · Esc 返回输入',
  localHint: '本地输出 · ⏎ 展开/收起 · Esc 返回输入',
  messagePickHint: '消息选择 · ↑/↓ 移动 · Enter 展开 · Esc 退出',
  searchHitPosition: (index: number, total: number): string => `搜索结果 ${index}/${total}`,
  sessionPreset: (preset: string): string => `preset ${preset}`,
  sessionChildren: (count: number): string => `${count} 个子会话`,
  sessionChildrenExpand: (count: number): string => `展开 ${count} 个子会话`,
  sessionChildrenFold: '收起子会话',
  thinkingTitle: '思考折叠',
  thinkingEnabled: 'Enabled',
  thinkingDisabled: 'Disabled',
  btwTitle: '侧问',
  btwHint: 'c 复制 · Esc 关闭',
  btwPrompt: '侧问（无工具单轮，不进日志）？',
  btwUnavailable: '侧问不可用（llm 服务未挂载）',
  btwFailed: (message: string): string => `侧问失败：${message}`,
  activityTitle: '动画帧',
  activityFrameName: (id: string): string => id === 'moon' ? '月相' : id === 'dots' ? '圆点' : '星芒',
  activityFrameSwitched: (name: string): string => `动画帧：${name}`,
  activityFrameInvalid: (id: string): string => `未知帧预设：${id}`,
  activityUsage: '用法：/activity（选择器）或 /activity frames <star|moon|dots>',
  themeCustomLabel: (name: string): string => `${name}（自定义）`,
  themeCustomSwitched: (name: string): string => `自定义主题：${name}`,
  settingsDiffLayout: 'Diff 布局',
  diffAuto: '自动（宽屏分栏）',
  diffFull: '强制分栏',
  diffUnified: '单栏（unified）',
  tabTitleBase: (session: string): string => `dsh tui · ${session}`,
  tabTitleIdle: '✦ idle — dsh tui',
  tabTitleNew: 'new session',
  tipGroups: [
    {
      title: '快捷键',
      lines: [
        'Esc / Ctrl+C 中断当前回合；空闲时 Ctrl+C 再按一次退出（3 秒窗口）',
        'Ctrl+Enter 打断当前回合并立即发送；busy 时 Tab（有输入）= 回合后处理',
        'Alt+Up 取回排队消息 · Alt+Enter 插话（steer） · Ctrl+T 显隐思考',
        'Ctrl+R 会话 · Ctrl+G 模型 · Ctrl+P 权限 · Ctrl+F 搜索 · Ctrl+B 分支',
        'Ctrl+O jobs 展开/收起 · Ctrl+L 轨迹 · Ctrl+K 折叠 · Ctrl+Z 撤销/重做',
      ],
    },
    {
      title: '命令',
      lines: [
        '/settings 聚合设置（语言/主题/Enter 行为/键位/动画/配置）',
        '/keymap 交互预设（cc/pi/opencode）· /theme 视觉预设（web/cc/pi/opencode）',
        '/status /tokens /cost /doctor 状态与诊断 · /queue 排队消息',
        '/rewind 回退到一条用户消息（fork 分支 + 回填输入框） · /trajectory 轨迹',
        '/export [md] 导出会话 · /rate 反馈评分 → / 看全量命令',
      ],
    },
    {
      title: '工作流',
      lines: [
        '/plan 进入计划模式（Ctrl+E 退出）；计划审批可批准/拒绝/去讨论',
        '/goal 创建目标并多轮自动推进（/goal blocked 说明阻塞）',
        'Ctrl+B 分支点选择器把历史 fork 成新会话（/clone 同约束）',
        'busy 时 Enter 默认排队；/settings 或 DSH_TUI_ENTER=steer 改为插话',
        '子代理会话只读（提交拦截）；/quit 等命令仍可用',
      ],
    },
    {
      title: '个性化',
      lines: [
        '/theme 四套视觉预设 + DSH_TUI_THEME 明暗（自动跟随终端背景）',
        'DSH_TUI_KEYMAP / DSH_TUI_ENTER / DSH_TUI_LANG / DSH_TUI_ANIM=0',
        '/lang 随时双语切换；/keymap 与 /theme 独立切换',
      ],
    },
    {
      title: '避坑',
      lines: [
        'Shift+Enter 换行；IME 组合输入不会误发',
        '粘贴超过 30 行会先弹确认',
        '输入框聚焦时 Home/End 移动光标；焦点环上滚动转录',
        'cc 预设 Ctrl+X 用 $EDITOR 编辑当前输入（/compose 通用）',
      ],
    },
  ],
  // pi 预设面板（Ctrl+C 中断 / Ctrl+G 撰写 / Ctrl+P 模型；权限走 /permission）
  hotkeysSectionsPi: [
    {
      title: '输入',
      rows: [
        { keys: 'Enter', action: '发送消息' },
        { keys: 'Alt+Enter', action: '并入当前轮（steer）' },
        { keys: 'Alt+Up', action: '取回排队消息' },
        { keys: '↑/↓', action: '输入历史' },
        { keys: 'Ctrl+Z', action: '撤销' },
        { keys: 'Ctrl+Shift+Z', action: '重做' },
      ],
    },
    {
      title: '会话与模型',
      rows: [
        { keys: 'Ctrl+R', action: '会话列表' },
        { keys: 'Alt+R', action: '输入历史搜索' },
        { keys: 'Ctrl+P', action: '选择模型' },
        { keys: 'Ctrl+G', action: '编辑器撰写消息' },
        { keys: 'Ctrl+E', action: '退出 plan 模式' },
        { keys: 'Ctrl+W', action: '切换工作目录' },
        { keys: 'Ctrl+B', action: '分支新会话' },
        { keys: '/permission', action: '权限预设' },
      ],
    },
    {
      title: '消息与视图',
      rows: [
        { keys: 'Ctrl+F', action: '搜索' },
        { keys: 'Ctrl+Y', action: '评价回复' },
        { keys: 'Ctrl+X', action: '复制回复' },
        { keys: 'Ctrl+K', action: '折叠旧消息' },
        { keys: 'Ctrl+T', action: 'thinking 开关' },
        { keys: 'Ctrl+O', action: 'jobs 折叠/展开' },
        { keys: 'Ctrl+L', action: '轨迹（事件日志）' },
        { keys: 'PgUp/PgDn', action: '滚动' },
        { keys: 'Tab · Esc', action: '焦点循环 / 取消' },
        { keys: 'Enter', action: '展开/收起（thinking/工具卡/长消息）' },
      ],
    },
    {
      title: '命令与退出',
      rows: [
        { keys: '/', action: 'slash 命令（如 /model、/permission、/config）' },
        { keys: 'Ctrl+/', action: '命令面板' },
        { keys: '! · !!', action: '执行 shell：发送 / 静默' },
        { keys: 'Ctrl+C', action: '中断当前轮' },
        { keys: 'Esc', action: '中断当前轮' },
        { keys: 'Ctrl+D', action: '退出' },
      ],
    },
  ],
  // opencode 预设面板（Ctrl+X leader + 和弦、Ctrl+P 命令面板、Ctrl+C 清输入）
  hotkeysSectionsOpencode: [
    {
      title: '输入',
      rows: [
        { keys: 'Enter', action: '发送消息' },
        { keys: 'Alt+Enter', action: '并入当前轮（steer）' },
        { keys: 'Alt+Up', action: '取回排队消息' },
        { keys: 'Ctrl+C', action: '清空输入（运行中）' },
        { keys: '↑/↓', action: '输入历史' },
        { keys: 'Ctrl+Z', action: '撤销' },
        { keys: 'Ctrl+Shift+Z', action: '重做' },
      ],
    },
    {
      title: '会话与分支',
      rows: [
        { keys: 'Ctrl+X l', action: '会话列表' },
        { keys: 'Alt+R', action: '输入历史搜索' },
        { keys: 'Ctrl+X n', action: '新会话' },
        { keys: 'Ctrl+R', action: '重命名会话' },
        { keys: 'Ctrl+X g', action: '轨迹（时间线）' },
        { keys: 'Ctrl+B', action: '分支新会话' },
        { keys: 'Ctrl+W', action: '切换工作目录' },
      ],
    },
    {
      title: '模型与命令',
      rows: [
        { keys: 'Ctrl+X m', action: '选择模型' },
        { keys: 'Ctrl+P', action: '命令面板' },
        { keys: 'Ctrl+X e', action: '编辑器撰写' },
        { keys: 'Ctrl+X t', action: '主题预设' },
        { keys: 'Ctrl+X c', action: '压缩上下文' },
        { keys: '/permission', action: '权限预设' },
      ],
    },
    {
      title: '消息与视图',
      rows: [
        { keys: 'Ctrl+F', action: '搜索' },
        { keys: 'Ctrl+X y', action: '复制回复' },
        { keys: 'Ctrl+X h', action: 'thinking 开关' },
        { keys: 'Ctrl+Y', action: '评价回复' },
        { keys: 'Ctrl+K', action: '折叠旧消息' },
        { keys: 'Ctrl+O', action: 'jobs 折叠/展开' },
        { keys: 'PgUp/PgDn', action: '滚动' },
        { keys: 'Tab · Esc', action: '焦点循环 / 取消' },
        { keys: 'Enter', action: '展开/收起（thinking/工具卡/长消息）' },
      ],
    },
    {
      title: '命令与退出',
      rows: [
        { keys: 'Ctrl+X', action: 'leader 键（先按 Ctrl+X 再按字母）' },
        { keys: '/', action: 'slash 命令（如 /model、/permission、/config）' },
        { keys: '! · !!', action: '执行 shell：发送 / 静默' },
        { keys: 'Esc', action: '中断当前轮' },
        { keys: 'Ctrl+C', action: '退出（空闲时）' },
        { keys: 'Ctrl+D', action: '退出' },
        { keys: 'Ctrl+X x', action: '导出会话日志' },
      ],
    },
  ],
  queueFirst: (count: number, preview: string): string => `${count} 条排队 · ${preview}`,
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
  modelSwitched: (value: string): string => `模型已切换：${value}`,
  unknownModel: (value: string): string => `未知模型：${value}（用 /model 打开列表选择）`,
  presetSwitched: (value: string): string => `权限预设已切换：${value}`,
  unknownPreset: (value: string, available: string): string => `未知权限预设：${value}（可用：${available}）`,

  // /config（web ui-settings 的终端对应）
  configTitle: '配置',
  configProviders: '供应商列表',
  configAddProvider: '添加供应商',
  configPreview: '预览配置文件',
  configOpenEditor: '在编辑器中打开',
  configCopyPath: '复制配置文件路径',
  configPath: (path: string): string => `配置文件：${path}`,
  configProvidersTitle: '供应商',
  configUnavailable: 'settings 服务不可用（仅支持查看文件路径）',
  addProviderTitle: '添加供应商',
  addProviderRoutePrompt: '路由 id（供应商路由名，如 my-gateway）',
  addProviderRouteCustom: '自定义新路由',
  addProviderNamePrompt: '显示名称（可选）',
  addProviderBaseUrlPrompt: 'Base URL（可选，如 https://api.example.com/v1）',
  addProviderProtocolPrompt: '接口协议',
  addProviderKeyEnvPrompt: 'API Key 环境变量名（可选，填入变量名而非密钥）',
  providerSaved: (route: string): string => `已保存供应商：${route}`,
  providerSaveFailed: (message: string): string => `供应商保存失败：${message}`,
  editorUnset: '$EDITOR 未设置，无法打开编辑器',
  // Warp 通知（OSC 777；格式 ESC ] 777 ; notify ; <title> ; <body> BEL）
  warpNotifyTitle: 'dsh tui',
  warpTurnComplete: (summary: string): string => `完成 · ${summary}`,
  warpTurnFailed: (code: string): string => `失败 · ${code}`,
  warpApproval: (tool: string): string => `需要审批 · ${tool}`,
  warpToolError: (name: string): string => `工具失败 · ${name}`,
  projectionUnwritable: (key: string): string => `投影 ${key} 没有对应的写命令（插件需注册同名命令）`,
  // 审批卡命令块（CC-02，Claude Code 权限弹窗语义）
  permissionCommand: '命令',
  permissionImpact: (path: string): string => `将修改：${path}`,
  // 会话切换反馈（CC-09）
  resumedSession: (session: string): string => `已恢复会话 ${session}`,
  // /rename（会话标题 + 工作区目录两种目标）
  renameSession: '会话标题',
  renameWorkspace: '工作区目录',
  renameTarget: '重命名目标',
  wsRenamePrompt: '新的目录名（单段，不含路径分隔符）',
  wsRenameInvalid: '名称需为单段目录名（不含 / 或 \\）',
  wsRenamed: (path: string): string => `工作区已重命名：${path}`,
  wsRenameFailed: (message: string): string => `工作区重命名失败：${message}`,
  // 轨迹视图（B11/H31）
  trajectoryTitle: '轨迹',
  trajectoryEvents: (n: number): string => `${n} 条事件`,
  trajectoryFilterHint: '过滤（tool:<名>/kind:<类型>/turn:<n>/err: 与关键词 AND）· [ ] 跳错误 · { } 跳轮次 · ↑/↓ 滚动 · Esc 关闭',
  // /compose（pi A3，$EDITOR 撰写消息）
  composePlaceholder: '# 在此撰写消息，保存并退出后发送（删除本行可移除注释）',
  composeEmpty: '草稿为空，未发送',
  composeFailed: (message: string): string => `编辑器撰写失败：${message}`,
  // /keymap（cc/pi 快捷键双预设）
  keymap: '快捷键预设',
  keymapDescription: 'cc 为 Claude Code 式键位，pi 为 pi coding-agent 式键位',
  keymapSwitched: (id: string): string => `快捷键预设已切换：${id}`,
  keymapUnknown: (value: string, available: string): string => `未知快捷键预设：${value}（可用：${available}）`,
  // /theme + /preset（视觉主题预设 + 一键双预设）
  themePreset: '视觉主题',
  themePresetDescription: 'web 为 dsh web 设计 token，cc/pi/opencode 为对应产品风格的色板',
  themeSwitched: (id: string): string => `视觉主题已切换：${id}`,
  themeUnknown: (value: string, available: string): string => `未知视觉主题：${value}（可用：${available}）`,
  profileTitle: '预设',
  profileSwitched: (id: string): string => `预设已切换：${id}（键位 + 视觉主题）`,
  profileUnknown: (value: string, available: string): string => `未知预设：${value}（可用：${available}）`,
  // /settings 聚合面板（M2）
  settingsTitle: '设置',
  settingsHint: '↑/↓ 选择 · PgUp/PgDn 翻页 · 数字直选 · Enter 执行 · Esc 关闭',
  settingsCycleHint: '←/→ 切换值',
  settingsLanguage: '语言',
  settingsTheme: '主题',
  settingsEnter: 'Enter 行为',
  settingsKeymap: '快捷键预设',
  settingsAnim: '动画',
  settingsConfig: '配置文件',
  settingsFooter: 'Footer 档位',
  footerFull: '完整',
  footerCompact: '紧凑',
  footerMinimal: '极简',
  themeVariantDark: '暗色',
  themeVariantLight: '亮色',
  themeVariantAuto: '跟随终端',
  enterQueue: '排队（web 语义）',
  enterSteer: '并入当前轮（steer）',
  enterSwitched: (mode: string): string => `Enter 行为：${mode}`,
  pressAgainToExit: '再按一次退出',
  queuedFollowUp: '已排队：当前回合结束后处理',
  pendingReposted: (n: number): string => `已中断 · ${n} 条排队消息将自动重投`,
  modeDefault: '默认',
  modePlan: '计划',
  modeFull: '完全访问',
  sessionModeSwitched: (mode: string): string => `${mode} 模式`,
  reviewFeedback: '反馈',
  reviewFeedbackEmpty: '反馈（直接打字进入）',
  reviewApproveError: '批准不能附带反馈',
  rewindPickerTitle: '时间回溯 · 选择要回退到的用户消息',
  rewindNoTarget: '不能回退到第一条消息',
  rewindEmpty: '没有可回退的用户消息',
  rewindNotice: '已回退到该消息之前（可修改后重发）',
  resumeHint: '恢复本会话',
  transcriptToScrollback: '转录已写入终端 scrollback（Cmd+F 可搜索）',
  transcriptEmpty: '转录为空',
  searchUnavailableRegular: 'regular 模式无应用内滚动，搜索跳转不可用（可用终端原生 Cmd+F）',
  animOn: '开',
  animOff: '关',
  animSwitched: (state: string): string => `动画：${state}`,
  titlesBackfilled: (n: number): string => `已为 ${n} 个历史会话补全标题`,
  // /plugins（H20/H21 代理视图）与 /workspace（M3/M4）
  pluginsTitle: '插件与能力',
  pluginsHint: '↑/↓ 选择 · Enter 执行/查看 · PgUp/PgDn 翻页 · Esc 关闭',
  pluginsCommands: (n: number): string => `命令 (${n})`,
  pluginsSkills: (n: number): string => `技能 (${n})`,
  pluginsProjections: (n: number): string => `投影 (${n})`,
  pluginsSkillHint: '选中插入输入框',
  pluginsStructured: '结构化投影（无枚举）',
  // 斜杠菜单
  slashNoMatch: '无匹配命令',
  slashMore: (n: number): string => `↓ 还有 ${n} 条 · 继续输入缩小范围`,
  slashHint: '↑/↓ 选择 · PgUp/PgDn 翻页 · Tab 补全 · Enter 执行 · Esc 取消',
  slashPopupTitle: (n: number): string => `命令 · ${n} 项`,
  // 窄终端也要留住面板入口（Esc 取消是通用语义，见 /hotkeys），故不进本行；
  // 弹层行最挤，Tab 补全不写进底栏（Tab 键仍然可用）。
  slashPopupHint: '↑/↓ 选择 · PgUp/PgDn 翻页 · Enter 执行 · Ctrl+P 面板',
  workspaceTitle: '工作区',
  workspaceCurrent: '当前',
  workspaceUsage: '用法：/workspace [resume|rename|open <路径>] · resume=最近列表 · rename=重命名当前目录 · open=绝对/相对路径或 file:// URI（新建会话）',
  workspaceSessions: (n: number): string => `${n} 个会话`,

  // TUI-native (no web equivalent; bilingual for consistency)
  language: '语言',
  chooseLanguage: '选择语言',
  brandTagline: '探索未至之境！',
  backToBottom: '回到底部',
  newMessages: (n: number): string => `${n} 条新消息`,
  statusModel: '模型',
  statusState: '状态',
  statusSession: '会话',
  statusDirectory: '目录',
  statusTokens: 'Tokens',
  statusCacheHit: '缓存命中',
  statusContextUsage: '上下文占用',
  statusTitle: '标题',
  stateWorking: '工作中',
  stateIdle: '空闲',
  tokensTitle: 'Token 明细',
  tokensInput: '输入',
  tokensCacheRead: '缓存读',
  tokensCacheWrite: '缓存写',
  tokensOutput: '输出',
  doctorTitle: '环境自检',
  doctorApiKey: 'API key',
  doctorApiKeyMissing: '未配置（DEEPSEEK_API_KEY）',
  doctorApiKeySet: '已配置（脱敏）',
  doctorConfig: '配置',
  contextWindowLabel: '上下文窗口',
  initCreated: (path: string): string => `已创建 ${path}`,
  initExists: 'AGENTS.md 已存在',
  agentsTitle: '子代理',
  agentsEmpty: '本会话没有子代理',
  skillsTitle: '技能目录',
  skillsEmpty: '无可用技能',
  ctxTitle: '已加载上下文',
  ctxEmpty: '本次会话暂无注入上下文',
  noteMcp: 'MCP 未配置：在 cordis.patch.yml 插入 @deepseek-ai/dsh-mcp-client 行后，工具以 mcp__<服务器>__<工具> 注册。',
  notePermissions: '文件/shell/sandbox/审批策略由当前 DSH profile 决定；/permission 切换预设（full-access 有确认）。',
  noteLogin: '凭证来自环境变量（如 DEEPSEEK_API_KEY）或 provider 配置；/provider 可添加提供方。',
  noteLogout: '删除凭证环境变量或 settings.yaml 中的 provider 配置即登出（DSH 无会话级登出）。',
  noteAddDir: '文件策略作用域由当前 DSH profile 决定（默认启动目录）；/permission 切换范围。',
  noteHooks: 'DSH 当前无等价 hooks 机制，本命令为占位说明。',
  noteVim: '终端由 pi 引擎驱动，无 Vim 模态编辑（HTTP 系客户端有）；本命令为占位说明。',
  noteTerminalSetup: '需要扩展键盘协议（kitty/iTerm2/WezTerm/ghostty）以启用 ⌘/Ctrl+Enter 等修饰键；粘贴经 Ctrl+V。',
  noteConnect: '本客户端是进程内 profile，不支持远程连接（远程场景用 HTTP 系客户端）。',
  // web ui-user-questions locale, verbatim
  skipQuestion: '跳过本题',
  prevQuestion: '上一题',
  questionProgress: (index, total) => `${index} / ${total}`,
  pickHint: 'PgUp/PgDn 翻页 · 数字直选 · Enter 确认 · Esc 取消',
  multiPickHint: 'PgUp/PgDn 翻页 · 数字/空格 多选 · Enter 确认 · Esc 取消',
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
  youLabel: 'You',
  claudeLabel: 'Claude',
  durationSeconds: (seconds: number): string => `${seconds}s`,
  durationMinutes: (minutes: number, seconds: string): string => `${minutes}m ${seconds}s`,
  stop: 'Stop generating',
  send: 'Send message',
  quit: 'quit',
  interrupt: 'interrupt',
  inputKept: 'input is kept and sent when the reply ends',
  hotkeysTitle: 'Hotkeys',
  // Sectioned, aligned-column layout: one binding per row instead of the old
  // run-on lines that overflowed the card.
  hotkeysSections: [
    {
      title: 'Input',
      rows: [
        { keys: 'Enter', action: 'Send · steer into the running turn' },
        { keys: 'Ctrl+Enter', action: 'Interrupt the turn and send' },
        { keys: 'Alt+Enter', action: 'Steer into the running turn' },
        { keys: 'Alt+Up', action: 'Retrieve a queued message' },
        { keys: '↑/↓', action: 'Input history' },
        { keys: 'Ctrl+Z', action: 'Undo' },
        { keys: 'Ctrl+Shift+Z', action: 'Redo' },
      ],
    },
    {
      title: 'Session & model',
      rows: [
        { keys: 'Ctrl+R', action: 'Session list' },
        { keys: 'Alt+R', action: 'Input history search' },
        { keys: 'Shift+Tab', action: 'Cycle session modes (default/plan/full access)' },
        { keys: 'Ctrl+G', action: 'Pick model' },
        { keys: 'Ctrl+P', action: 'Cycle permission preset (inline)' },
        { keys: 'Ctrl+E', action: 'Exit plan mode' },
        { keys: 'Ctrl+W', action: 'Switch workspace' },
        { keys: 'Ctrl+B', action: 'Fork new session' },
      ],
    },
    {
      title: 'Messages & view',
      rows: [
        { keys: 'Ctrl+F', action: 'Search' },
        { keys: '[', action: 'Export transcript to scrollback (search with Cmd+F)' },
        { keys: 'Ctrl+Y', action: 'Rate reply' },
        { keys: 'Ctrl+X', action: 'Edit input in $EDITOR' },
        { keys: 'Ctrl+K', action: 'Fold old messages' },
        { keys: 'Ctrl+T', action: 'Toggle thinking' },
        { keys: 'Ctrl+O', action: 'Fold/expand jobs' },
        { keys: 'Ctrl+L', action: 'Trajectory (event log)' },
        { keys: 'PgUp/PgDn', action: 'Scroll' },
        { keys: 'Tab', action: 'Focus cycle · follow-up while running' },
        { keys: 'Enter', action: 'Expand/collapse (thinking / tool cards / long messages)' },
      ],
    },
    {
      title: 'Commands & quit',
      rows: [
        { keys: '/', action: 'Slash commands (e.g. /model, /permission, /config)' },
        { keys: 'Ctrl+/', action: 'Command palette' },
        { keys: '! · !!', action: 'Run shell: send / silent' },
        { keys: 'Esc · Ctrl+C', action: 'Interrupt the running turn' },
        { keys: 'Ctrl+C', action: 'Clear input · press again to exit (idle)' },
        { keys: 'Ctrl+D', action: 'Press again to exit' },
      ],
    },
  ],
  hotkeysHint: '↑/↓ scroll · PgUp/PgDn page · Esc close',
  tipsTitle: 'Usage tips',
  tipsHint: '↑/↓ scroll · PgUp/PgDn page · Esc close',
  historyTitle: 'Input history',
  historyEmpty: 'No input history yet',
  expandHint: 'Injected content · ⏎ expand/collapse · Esc back',
  localHint: 'Local output · ⏎ expand/collapse · Esc back',
  messagePickHint: 'Message pick · ↑/↓ move · Enter expand · Esc exit',
  searchHitPosition: (index: number, total: number): string => `Search hit ${index}/${total}`,
  sessionPreset: (preset: string): string => `preset ${preset}`,
  sessionChildren: (count: number): string => `${count} child sessions`,
  sessionChildrenExpand: (count: number): string => `Expand ${count} child sessions`,
  sessionChildrenFold: 'Fold child sessions',
  thinkingTitle: 'Thinking fold',
  thinkingEnabled: 'Enabled',
  thinkingDisabled: 'Disabled',
  btwTitle: 'Side question',
  btwHint: 'c copy · Esc close',
  btwPrompt: 'Side question (tool-less one-shot, no log)?',
  btwUnavailable: 'Side question unavailable (llm service not mounted)',
  btwFailed: (message: string): string => `Side question failed: ${message}`,
  activityTitle: 'Activity frames',
  activityFrameName: (id: string): string => id === 'moon' ? 'Moon' : id === 'dots' ? 'Dots' : 'Star',
  activityFrameSwitched: (name: string): string => `Activity frames: ${name}`,
  activityFrameInvalid: (id: string): string => `Unknown frame set: ${id}`,
  activityUsage: 'Usage: /activity (picker) or /activity frames <star|moon|dots>',
  themeCustomLabel: (name: string): string => `${name} (custom)`,
  themeCustomSwitched: (name: string): string => `Custom theme: ${name}`,
  settingsDiffLayout: 'Diff layout',
  diffAuto: 'Auto (split wide)',
  diffFull: 'Force split',
  diffUnified: 'Unified',
  tabTitleBase: (session: string): string => `dsh tui · ${session}`,
  tabTitleIdle: '✦ idle — dsh tui',
  tabTitleNew: 'new session',
  tipGroups: [
    {
      title: 'Shortcuts',
      lines: [
        'Esc / Ctrl+C interrupt the turn; idle Ctrl+C twice to quit (3s window)',
        'Ctrl+Enter interrupts and sends now; busy Tab (with input) = follow-up',
        'Alt+Up fetch queued · Alt+Enter steer · Ctrl+T toggle thinking',
        'Ctrl+R sessions · Ctrl+G model · Ctrl+P permissions · Ctrl+F search · Ctrl+B fork',
        'Ctrl+O jobs · Ctrl+L trajectory · Ctrl+K fold · Ctrl+Z undo/redo',
      ],
    },
    {
      title: 'Commands',
      lines: [
        '/settings aggregated panel (language/theme/enter/keymap/animation/config)',
        '/keymap interaction presets (cc/pi/opencode) · /theme visual presets (web/cc/pi/opencode)',
        '/status /tokens /cost /doctor status & diagnostics · /queue queued messages',
        '/rewind back to a user message (fork + refill) · /trajectory event log',
        '/export [md] export · /rate feedback — type / for the full catalog',
      ],
    },
    {
      title: 'Workflow',
      lines: [
        '/plan plan mode (Ctrl+E exits); approve/reject/discuss the plan review',
        '/goal create a goal with automatic rounds (blocked reason via /goal)',
        'Ctrl+B fork-point picker clones history into a new session (/clone same rules)',
        'busy Enter queues by default; /settings or DSH_TUI_ENTER=steer switches to steer',
        'subagent sessions are read-only (submit blocked; /quit still works)',
      ],
    },
    {
      title: 'Personalization',
      lines: [
        '/theme four visual presets + DSH_TUI_THEME light/dark (auto follows terminal)',
        'DSH_TUI_KEYMAP / DSH_TUI_ENTER / DSH_TUI_LANG / DSH_TUI_ANIM=0',
        '/lang toggles zh/en anytime; /keymap and /theme switch independently',
      ],
    },
    {
      title: 'Gotchas',
      lines: [
        'Shift+Enter inserts a newline; IME composition never sends mid-typing',
        'Pastes over 30 lines ask for confirmation first',
        'Home/End move the caret while the composer is focused; scroll on the focus ring',
        'cc preset Ctrl+X edits the current input via $EDITOR (/compose everywhere)',
      ],
    },
  ],
  // pi-preset panel (Ctrl+C interrupt / Ctrl+G compose / Ctrl+P model)
  hotkeysSectionsPi: [
    {
      title: 'Input',
      rows: [
        { keys: 'Enter', action: 'Send message' },
        { keys: 'Alt+Enter', action: 'Steer into the running turn' },
        { keys: 'Alt+Up', action: 'Retrieve a queued message' },
        { keys: '↑/↓', action: 'Input history' },
        { keys: 'Ctrl+Z', action: 'Undo' },
        { keys: 'Ctrl+Shift+Z', action: 'Redo' },
      ],
    },
    {
      title: 'Session & model',
      rows: [
        { keys: 'Ctrl+R', action: 'Session list' },
        { keys: 'Alt+R', action: 'Input history search' },
        { keys: 'Ctrl+P', action: 'Pick model' },
        { keys: 'Ctrl+G', action: 'Compose in editor' },
        { keys: 'Ctrl+E', action: 'Exit plan mode' },
        { keys: 'Ctrl+W', action: 'Switch workspace' },
        { keys: 'Ctrl+B', action: 'Fork new session' },
        { keys: '/permission', action: 'Permission preset' },
      ],
    },
    {
      title: 'Messages & view',
      rows: [
        { keys: 'Ctrl+F', action: 'Search' },
        { keys: 'Ctrl+Y', action: 'Rate reply' },
        { keys: 'Ctrl+X', action: 'Copy reply' },
        { keys: 'Ctrl+K', action: 'Fold old messages' },
        { keys: 'Ctrl+T', action: 'Toggle thinking' },
        { keys: 'Ctrl+O', action: 'Fold/expand jobs' },
        { keys: 'Ctrl+L', action: 'Trajectory (event log)' },
        { keys: 'PgUp/PgDn', action: 'Scroll' },
        { keys: 'Tab · Esc', action: 'Focus cycle / cancel' },
        { keys: 'Enter', action: 'Expand/collapse (thinking/tool/long message)' },
      ],
    },
    {
      title: 'Commands & quit',
      rows: [
        { keys: '/', action: 'Slash commands (e.g. /model, /permission, /config)' },
        { keys: 'Ctrl+/', action: 'Command palette' },
        { keys: '! · !!', action: 'Run shell: send / silent' },
        { keys: 'Ctrl+C', action: 'Interrupt the running turn' },
        { keys: 'Esc', action: 'Interrupt the running turn' },
        { keys: 'Ctrl+D', action: 'Quit' },
      ],
    },
  ],
  // opencode-preset panel (Ctrl+X leader chords, Ctrl+P command list, Ctrl+C clears input)
  hotkeysSectionsOpencode: [
    {
      title: 'Input',
      rows: [
        { keys: 'Enter', action: 'Send message' },
        { keys: 'Alt+Enter', action: 'Steer into the running turn' },
        { keys: 'Alt+Up', action: 'Retrieve a queued message' },
        { keys: 'Ctrl+C', action: 'Clear input (while running)' },
        { keys: '↑/↓', action: 'Input history' },
        { keys: 'Ctrl+Z', action: 'Undo' },
        { keys: 'Ctrl+Shift+Z', action: 'Redo' },
      ],
    },
    {
      title: 'Session & fork',
      rows: [
        { keys: 'Ctrl+X l', action: 'Session list' },
        { keys: 'Alt+R', action: 'Input history search' },
        { keys: 'Ctrl+X n', action: 'New session' },
        { keys: 'Ctrl+R', action: 'Rename session' },
        { keys: 'Ctrl+X g', action: 'Trajectory (timeline)' },
        { keys: 'Ctrl+B', action: 'Fork new session' },
        { keys: 'Ctrl+W', action: 'Switch workspace' },
      ],
    },
    {
      title: 'Model & commands',
      rows: [
        { keys: 'Ctrl+X m', action: 'Pick model' },
        { keys: 'Ctrl+P', action: 'Command list' },
        { keys: 'Ctrl+X e', action: 'Compose in editor' },
        { keys: 'Ctrl+X t', action: 'Theme preset' },
        { keys: 'Ctrl+X c', action: 'Compact context' },
        { keys: '/permission', action: 'Permission preset' },
      ],
    },
    {
      title: 'Messages & view',
      rows: [
        { keys: 'Ctrl+F', action: 'Search' },
        { keys: 'Ctrl+X y', action: 'Copy reply' },
        { keys: 'Ctrl+X h', action: 'Toggle thinking' },
        { keys: 'Ctrl+Y', action: 'Rate reply' },
        { keys: 'Ctrl+K', action: 'Fold old messages' },
        { keys: 'Ctrl+O', action: 'Fold/expand jobs' },
        { keys: 'PgUp/PgDn', action: 'Scroll' },
        { keys: 'Tab · Esc', action: 'Focus cycle / cancel' },
        { keys: 'Enter', action: 'Expand/collapse (thinking/tool/long message)' },
      ],
    },
    {
      title: 'Commands & quit',
      rows: [
        { keys: 'Ctrl+X', action: 'Leader key (press Ctrl+X, then a letter)' },
        { keys: '/', action: 'Slash commands (e.g. /model, /permission, /config)' },
        { keys: '! · !!', action: 'Run shell: send / silent' },
        { keys: 'Esc', action: 'Interrupt the running turn' },
        { keys: 'Ctrl+C', action: 'Quit (while idle)' },
        { keys: 'Ctrl+D', action: 'Quit' },
        { keys: 'Ctrl+X x', action: 'Export session log' },
      ],
    },
  ],
  queueFirst: (count: number, preview: string): string => `${count} queued · ${preview}`,
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
  modelSwitched: (value: string): string => `Model switched: ${value}`,
  unknownModel: (value: string): string => `Unknown model: ${value} (open /model for the list)`,
  presetSwitched: (value: string): string => `Permission preset: ${value}`,
  unknownPreset: (value: string, available: string): string => `Unknown preset: ${value} (available: ${available})`,

  // /config (terminal counterpart of the web ui-settings pages)
  configTitle: 'Config',
  configProviders: 'Provider list',
  configAddProvider: 'Add provider',
  configPreview: 'Preview settings file',
  configOpenEditor: 'Open in editor',
  configCopyPath: 'Copy settings path',
  configPath: (path: string): string => `Settings file: ${path}`,
  configProvidersTitle: 'Providers',
  configUnavailable: 'the settings service is unavailable (path only)',
  addProviderTitle: 'Add provider',
  addProviderRoutePrompt: 'Route id (the provider route name, e.g. my-gateway)',
  addProviderRouteCustom: 'Custom new route',
  addProviderNamePrompt: 'Display name (optional)',
  addProviderBaseUrlPrompt: 'Base URL (optional, e.g. https://api.example.com/v1)',
  addProviderProtocolPrompt: 'Wire protocol',
  addProviderKeyEnvPrompt: 'API key env var name (optional; the variable name, not the key)',
  providerSaved: (route: string): string => `Provider saved: ${route}`,
  providerSaveFailed: (message: string): string => `Provider save failed: ${message}`,
  editorUnset: '$EDITOR is not set, cannot open an editor',
  // Warp notifications (OSC 777; format ESC ] 777 ; notify ; <title> ; <body> BEL)
  warpNotifyTitle: 'dsh tui',
  warpTurnComplete: (summary: string): string => `Done · ${summary}`,
  warpTurnFailed: (code: string): string => `Failed · ${code}`,
  warpApproval: (tool: string): string => `Approval needed · ${tool}`,
  warpToolError: (name: string): string => `Tool failed · ${name}`,
  projectionUnwritable: (key: string): string => `Projection ${key} has no writable command (plugins register a command with the same name)`,
  // Approval-card command block (CC-02, Claude Code permission-dialog parity)
  permissionCommand: 'Command',
  permissionImpact: (path: string): string => `Files affected: ${path}`,
  // Session-switch feedback (CC-09)
  resumedSession: (session: string): string => `Resumed session ${session}`,
  // /rename (session title + workspace directory targets)
  renameSession: 'Session title',
  renameWorkspace: 'Workspace directory',
  renameTarget: 'Rename target',
  wsRenamePrompt: 'New directory name (a single segment, no path separators)',
  wsRenameInvalid: 'The name must be a single directory segment (no / or \\)',
  wsRenamed: (path: string): string => `Workspace renamed: ${path}`,
  wsRenameFailed: (message: string): string => `Workspace rename failed: ${message}`,
  // Trajectory view (B11/H31)
  trajectoryTitle: 'Trajectory',
  trajectoryEvents: (n: number): string => `${n} events`,
  trajectoryFilterHint: 'Filter (tool:<name>/kind:<type>/turn:<n>/err: AND keywords) · [ ] error · { } turn · ↑/↓ scroll · Esc close',
  // /compose (pi A3, compose in $EDITOR)
  composePlaceholder: '# Write your message here; save and exit to send (delete this line to drop the comment)',
  composeEmpty: 'Draft was empty, nothing sent',
  composeFailed: (message: string): string => `Editor compose failed: ${message}`,
  // /keymap (cc/pi switchable hotkey presets)
  keymap: 'Hotkey preset',
  keymapDescription: 'cc is the Claude Code layout, pi the pi coding-agent layout',
  keymapSwitched: (id: string): string => `Hotkey preset: ${id}`,
  keymapUnknown: (value: string, available: string): string => `Unknown hotkey preset: ${value} (available: ${available})`,
  // /theme + /preset (visual theme preset + one-shot profile switch)
  themePreset: 'Theme',
  themePresetDescription: 'web is the dsh web design token palette; cc/pi/opencode mirror those products',
  themeSwitched: (id: string): string => `Theme: ${id}`,
  themeUnknown: (value: string, available: string): string => `Unknown theme: ${value} (available: ${available})`,
  profileTitle: 'Preset',
  profileSwitched: (id: string): string => `Preset: ${id} (keymap + theme)`,
  profileUnknown: (value: string, available: string): string => `Unknown preset: ${value} (available: ${available})`,
  // /settings panel (M2)
  settingsTitle: 'Settings',
  settingsHint: '↑/↓ select · PgUp/PgDn page · number to jump · Enter run · Esc close',
  settingsCycleHint: '←/→ cycle value',
  settingsLanguage: 'Language',
  settingsTheme: 'Theme',
  settingsEnter: 'Enter behavior',
  settingsKeymap: 'Hotkey preset',
  settingsAnim: 'Animations',
  settingsConfig: 'Config file',
  settingsFooter: 'Footer mode',
  footerFull: 'Full',
  footerCompact: 'Compact',
  footerMinimal: 'Minimal',
  themeVariantDark: 'Dark',
  themeVariantLight: 'Light',
  themeVariantAuto: 'Follow terminal',
  enterQueue: 'Queue (web semantics)',
  enterSteer: 'Steer into the running turn',
  enterSwitched: (mode: string): string => `Enter behavior: ${mode}`,
  pressAgainToExit: 'Press again to exit',
  queuedFollowUp: 'Queued: will process after this turn',
  pendingReposted: (n: number): string => `Interrupted · ${n} queued message${n === 1 ? '' : 's'} will be re-sent`,
  modeDefault: 'Default',
  modePlan: 'Plan',
  modeFull: 'Full access',
  sessionModeSwitched: (mode: string): string => `Mode: ${mode}`,
  reviewFeedback: 'Feedback',
  reviewFeedbackEmpty: 'Feedback (just start typing)',
  reviewApproveError: 'Approval cannot carry feedback',
  rewindPickerTitle: 'Rewind · pick the user message to rewind to',
  rewindNoTarget: 'Cannot rewind before the first message',
  rewindEmpty: 'No user messages to rewind to',
  rewindNotice: 'Rewound before that message (edit and resend)',
  resumeHint: 'Resume this session',
  transcriptToScrollback: 'Transcript written to terminal scrollback (search with Cmd+F)',
  transcriptEmpty: 'Transcript is empty',
  searchUnavailableRegular: 'No in-app scrolling in regular mode; search jump unavailable (use native Cmd+F)',
  animOn: 'On',
  animOff: 'Off',
  animSwitched: (state: string): string => `Animations: ${state}`,
  titlesBackfilled: (n: number): string => `Backfilled titles for ${n} past sessions`,
  // /plugins (H20/H21 proxy inventory) & /workspace (M3/M4)
  pluginsTitle: 'Plugins & capabilities',
  pluginsHint: '↑/↓ select · Enter run/inspect · PgUp/PgDn page · Esc close',
  pluginsCommands: (n: number): string => `Commands (${n})`,
  pluginsSkills: (n: number): string => `Skills (${n})`,
  pluginsProjections: (n: number): string => `Projections (${n})`,
  pluginsSkillHint: 'selected skills go into the composer',
  pluginsStructured: 'structured projection (no enum)',
  // Slash menu
  slashNoMatch: 'No matching commands',
  slashMore: (n: number): string => `↓${n} more · keep typing to narrow`,
  slashHint: '↑/↓ select · PgUp/PgDn page · Tab complete · Enter run · Esc cancel',
  slashPopupTitle: (n: number): string => `Commands · ${n}`,
  // The popup line is the tightest: Tab stays functional but is not hinted.
  slashPopupHint: '↑/↓ select · PgUp/PgDn page · Enter run · Ctrl+P palette',
  workspaceTitle: 'Workspace',
  workspaceCurrent: 'current',
  workspaceUsage: 'Usage: /workspace [resume|rename|open <path>] · resume=recent list · rename=rename current dir · open=absolute/relative path or file:// URI (new session)',
  workspaceSessions: (n: number): string => `${n} sessions`,

  // TUI-native
  language: 'Language',
  chooseLanguage: 'Choose language',
  brandTagline: 'Explore the uncharted!',
  backToBottom: 'to bottom',
  newMessages: (n: number): string => `${n} new messages`,
  statusModel: 'Model',
  statusState: 'State',
  statusSession: 'Session',
  statusDirectory: 'Directory',
  statusTokens: 'Tokens',
  statusCacheHit: 'Cache hit',
  statusContextUsage: 'Context usage',
  statusTitle: 'Title',
  stateWorking: 'working',
  stateIdle: 'idle',
  tokensTitle: 'Token detail',
  tokensInput: 'Input',
  tokensCacheRead: 'Cache read',
  tokensCacheWrite: 'Cache write',
  tokensOutput: 'Output',
  doctorTitle: 'Environment check',
  doctorApiKey: 'API key',
  doctorApiKeyMissing: 'not set (DEEPSEEK_API_KEY)',
  doctorApiKeySet: 'set (redacted)',
  doctorConfig: 'Config',
  contextWindowLabel: 'Context window',
  initCreated: (path: string): string => `Created ${path}`,
  initExists: 'AGENTS.md already exists',
  agentsTitle: 'Subagents',
  agentsEmpty: 'No subagents in this session',
  skillsTitle: 'Skill catalog',
  skillsEmpty: 'No skills available',
  ctxTitle: 'Loaded context',
  ctxEmpty: 'No injected context in this session yet',
  noteMcp: 'MCP not configured: insert an @deepseek-ai/dsh-mcp-client row in cordis.patch.yml; tools register as mcp__<server>__<tool>.',
  notePermissions: 'File/shell/sandbox/approval policy comes from the current DSH profile; /permission switches presets (full access confirms).',
  noteLogin: 'Credentials come from environment variables (e.g. DEEPSEEK_API_KEY) or provider config; /provider adds providers.',
  noteLogout: 'Remove the credential env var or the provider config in settings.yaml to log out (DSH has no session logout).',
  noteAddDir: 'The filesystem policy scope comes from the current DSH profile (defaults to the launch directory); /permission switches scope.',
  noteHooks: 'DSH has no hooks equivalent today; this command is a placeholder note.',
  noteVim: 'The terminal is driven by the pi engine without Vim modal editing (HTTP clients have it); placeholder note.',
  noteTerminalSetup: 'Extended keyboard protocols (kitty/iTerm2/WezTerm/ghostty) enable modifier keys like ⌘/Ctrl+Enter; paste with Ctrl+V.',
  noteConnect: 'This client is an in-process profile and cannot connect remotely (use an HTTP client for that).',
  // web ui-user-questions locale, verbatim
  skipQuestion: 'Skip this question',
  prevQuestion: 'Previous question',
  questionProgress: (index, total) => `${index} / ${total}`,
  pickHint: 'PgUp/PgDn page · number to pick · Enter confirm · Esc cancel',
  multiPickHint: 'PgUp/PgDn page · number/space multi-select · Enter confirm · Esc cancel',
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
