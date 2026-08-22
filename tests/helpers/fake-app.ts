/**
 * A deterministic TerminalApp stand-in for runner tests: records renders,
 * exposes the wired handlers, and never touches a real terminal.
 */

import type { SurfaceMeta, TerminalApp, TerminalAppHandlers, ModelChoice, SessionChoice, PermissionChoice, CommandChoice } from '../../src/app/terminal-app.ts'
import type { ApprovalAnswer, ApprovalQuestion } from '../../src/view/components/approval-view.ts'
import type { ViewDocument } from '../../src/document/document.ts'
import type { JobRow } from '../../src/view/components/panels.ts'

export class FakeApp implements TerminalApp {
  handlers: TerminalAppHandlers | undefined
  rendered: ViewDocument[] = []
  stopped = 0
  resets = 0
  meta: SurfaceMeta | undefined
  sessions: SessionChoice[] | undefined
  models: ModelChoice[] | undefined
  permissions: PermissionChoice[] | undefined
  commands: CommandChoice[] | undefined
  catalogs: CommandChoice[][] = []
  queues: number[] = []
  jobs: JobRow[][] = []
  workspaces: string[] = []
  forkPoints: SessionChoice[] | undefined
  /** Override the next askDialog answer (free-text dialogs). */
  dialogAnswer: string | undefined
  /** Per-dialog answers consumed FIFO (multi-step wizards); wins over dialogAnswer. */
  dialogQueue: string[] = []
  /** Faked focus for focusedEntryId(). */
  focusedId: string | null = null

  private startResolve!: () => void
  readonly started = new Promise<void>((resolve) => { this.startResolve = resolve })

  start(handlers: TerminalAppHandlers, meta: SurfaceMeta): void {
    this.handlers = handlers
    this.meta = meta
    this.startResolve()
  }

  render(doc: ViewDocument): void {
    this.rendered.push(structuredClone(doc))
  }

  reset(): void {
    this.resets++
  }

  stop(): void {
    this.stopped++
  }

  showSessionPicker(items: readonly SessionChoice[]): void {
    this.sessions = [...items]
  }

  sessionPickerRows: SessionChoice[][] = []
  setSessionPickerRows(rows: readonly SessionChoice[]): void {
    this.sessionPickerRows.push([...rows])
  }

  showModelPicker(items: readonly ModelChoice[]): void {
    this.models = [...items]
  }

  showPermissionPicker(items: readonly PermissionChoice[]): void {
    this.permissions = [...items]
  }

  showCommandPicker(items: readonly CommandChoice[]): void {
    this.commands = [...items]
  }

  setCommands(items: readonly CommandChoice[]): void {
    this.catalogs.push([...items])
  }

  /** Number of /hotkeys panel opens (G38 re-layout). */
  hotkeysShown = 0
  showHotkeys(): void {
    this.hotkeysShown++
  }

  /** Number of /tips panel opens (A18). */
  tipsShown = 0
  showTips(): void {
    this.tipsShown++
  }

  notifyQueue(count: number, messages?: readonly string[]): void {
    this.queues.push(count)
    this.queuedMessages.push(messages === undefined ? [] : [...messages])
  }

  queuedMessages: string[][] = []

  showJobs(rows: readonly JobRow[]): void {
    this.jobs.push([...rows])
  }

  setWorkspace(path: string): void {
    this.workspaces.push(path)
  }

  focusedEntryId(): string | null {
    return this.focusedId
  }

  restored: string[] = []
  restoreToEditor(text: string): void {
    this.restored.push(text)
  }

  queueRows: import('../../src/view/components/filterable-picker.ts').PickerRow[][] = []
  queueTitles: Array<string | undefined> = []
  showQueuePicker(rows: readonly import('../../src/view/components/filterable-picker.ts').PickerRow[], onPicked: (value: string | null) => void, title?: string): void {
    this.queueRows.push([...rows])
    this.queueTitles.push(title)
    this.queuePicked = onPicked
  }
  queuePicked: ((value: string | null) => void) | undefined

  projectionRows: import('../../src/app/terminal-app.ts').ProjectionRow[][] = []
  setProjections(rows: readonly import('../../src/app/terminal-app.ts').ProjectionRow[]): void {
    this.projectionRows.push([...rows])
  }

  showForkPicker(items: readonly SessionChoice[]): void {
    this.forkPoints = [...items]
  }

  /** B7: 时间回溯选择器（/rewind 与空输入双击 Esc 共用）。 */
  rewindPoints: readonly SessionChoice[] = []
  showRewindPicker(items: readonly SessionChoice[]): void {
    this.rewindPoints = [...items]
  }

  /** B7: 回填输入框（rewind 原消息）。 */
  composerText = ''
  setComposerText(text: string): void {
    this.composerText = text
  }

  trajectoryRows: import('../../src/app/terminal-app.ts').TrajectoryRow[][] = []
  showTrajectory(rows: readonly import('../../src/app/terminal-app.ts').TrajectoryRow[]): void {
    this.trajectoryRows.push([...rows])
  }

  toasts: Array<{ text: string; tone: string }> = []
  toast(text: string, tone: 'info' | 'error' | 'success' = 'info'): void {
    this.toasts.push({ text, tone })
  }

  editors: string[] = []
  async openExternalEditor(path: string): Promise<void> {
    this.editors.push(path)
  }

  copied: string[] = []
  copyText(text: string): void {
    this.copied.push(text)
  }

  keymaps: Array<import('../../src/app/pi/keymaps.ts').KeymapId> = []
  setKeymap(id: import('../../src/app/pi/keymaps.ts').KeymapId): void {
    this.keymaps.push(id)
  }

  composes = 0
  async composeInEditor(): Promise<void> {
    this.composes++
  }

  themeRefreshes = 0
  refreshTheme(): void {
    this.themeRefreshes++
  }

  settingsShown: Array<Array<import('../../src/app/terminal-app.ts').SettingsRow>> = []
  showSettings(rows: readonly import('../../src/app/terminal-app.ts').SettingsRow[]): void {
    this.settingsShown.push([...rows])
  }

  pluginsShown: Array<Array<import('../../src/app/terminal-app.ts').PluginsRow>> = []
  showPlugins(rows: readonly import('../../src/app/terminal-app.ts').PluginsRow[]): void {
    this.pluginsShown.push([...rows])
  }

  /** The most recent rendered document (last render wins). */
  get last(): ViewDocument {
    return this.rendered[this.rendered.length - 1]
  }

  questions: ApprovalQuestion[] = []

  async askDialog(question: ApprovalQuestion): Promise<ApprovalAnswer> {
    this.questions.push(question)
    const picked = this.dialogQueue.length > 0
      ? this.dialogQueue.shift()!
      : this.dialogAnswer ?? question.options[0] ?? 'typed-answer'
    return { picked, reason: 'picked' }
  }

  /** Drive the input handler as if the user submitted text. */
  input(text: string): void {
    if (this.handlers === undefined) throw new Error('FakeApp.input before start')
    this.handlers.onInput(text)
  }
}
