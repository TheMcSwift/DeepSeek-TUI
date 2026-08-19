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
  /** 分组 + 对齐列的快捷键面板数据（替代旧的单行拥挤文本）。 */
  hotkeysSections: readonly HotkeySection[]
  /** 面板底部提示行。 */
  hotkeysHint: string
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
  themeVariantDark: string
  themeVariantLight: string
  themeVariantAuto: string
  enterQueue: string
  enterSteer: string
  enterSwitched: (mode: string) => string
  animOn: string
  animOff: string
  animSwitched: (state: string) => string
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
  workspaceTitle: string
  workspaceCurrent: string
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
  // 分组 + 对齐列：每行一个按键组合，避免旧版一长串 ` · ` 挤压截断。
  hotkeysSections: [
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
        { keys: 'Esc', action: '中断当前轮' },
        { keys: 'Ctrl+C', action: '退出（空闲时）' },
        { keys: 'Ctrl+D', action: '退出' },
      ],
    },
  ],
  hotkeysHint: '↑/↓ 滚动 · PgUp/PgDn 翻页 · Esc 关闭',
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
  trajectoryFilterHint: '输入过滤 · ↑/↓ 滚动 · PgUp/PgDn 翻页 · Esc 关闭',
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
  settingsHint: '↑/↓ 选择 · 数字直选 · Enter 执行 · Esc 关闭',
  settingsCycleHint: '←/→ 切换值',
  settingsLanguage: '语言',
  settingsTheme: '主题',
  settingsEnter: 'Enter 行为',
  settingsKeymap: '快捷键预设',
  settingsAnim: '动画',
  settingsConfig: '配置文件',
  themeVariantDark: '暗色',
  themeVariantLight: '亮色',
  themeVariantAuto: '跟随终端',
  enterQueue: '排队（web 默认）',
  enterSteer: '并入当前轮（steer）',
  enterSwitched: (mode: string): string => `Enter 行为：${mode}`,
  animOn: '开',
  animOff: '关',
  animSwitched: (state: string): string => `动画：${state}`,
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
  slashHint: '↑/↓ 选择 · Tab 补全 · Enter 执行 · Esc 取消',
  workspaceTitle: '工作区',
  workspaceCurrent: '当前',
  workspaceSessions: (n: number): string => `${n} 个会话`,

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
  // Sectioned, aligned-column layout: one binding per row instead of the old
  // run-on lines that overflowed the card.
  hotkeysSections: [
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
        { keys: 'Ctrl+Y', action: 'Rate reply' },
        { keys: 'Ctrl+X', action: 'Copy reply' },
        { keys: 'Ctrl+K', action: 'Fold old messages' },
        { keys: 'Ctrl+T', action: 'Toggle thinking' },
        { keys: 'Ctrl+O', action: 'Fold/expand jobs' },
        { keys: 'Ctrl+L', action: 'Trajectory (event log)' },
        { keys: 'PgUp/PgDn', action: 'Scroll' },
        { keys: 'Tab · Esc', action: 'Focus cycle / cancel' },
        { keys: 'Enter', action: 'Expand/collapse (thinking / tool cards / long messages)' },
      ],
    },
    {
      title: 'Commands & quit',
      rows: [
        { keys: '/', action: 'Slash commands (e.g. /model, /permission, /config)' },
        { keys: 'Ctrl+/', action: 'Command palette' },
        { keys: '! · !!', action: 'Run shell: send / silent' },
        { keys: 'Esc', action: 'Interrupt the running turn' },
        { keys: 'Ctrl+C', action: 'Quit (while idle)' },
        { keys: 'Ctrl+D', action: 'Quit' },
      ],
    },
  ],
  hotkeysHint: '↑/↓ scroll · PgUp/PgDn page · Esc close',
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
  trajectoryFilterHint: 'Type to filter · ↑/↓ scroll · PgUp/PgDn page · Esc close',
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
  settingsHint: '↑/↓ select · number to jump · Enter run · Esc close',
  settingsCycleHint: '←/→ cycle value',
  settingsLanguage: 'Language',
  settingsTheme: 'Theme',
  settingsEnter: 'Enter behavior',
  settingsKeymap: 'Hotkey preset',
  settingsAnim: 'Animations',
  settingsConfig: 'Config file',
  themeVariantDark: 'Dark',
  themeVariantLight: 'Light',
  themeVariantAuto: 'Follow terminal',
  enterQueue: 'Queue (web default)',
  enterSteer: 'Steer into the running turn',
  enterSwitched: (mode: string): string => `Enter behavior: ${mode}`,
  animOn: 'On',
  animOff: 'Off',
  animSwitched: (state: string): string => `Animations: ${state}`,
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
  slashHint: '↑/↓ select · Tab complete · Enter run · Esc cancel',
  workspaceTitle: 'Workspace',
  workspaceCurrent: 'current',
  workspaceSessions: (n: number): string => `${n} sessions`,

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
