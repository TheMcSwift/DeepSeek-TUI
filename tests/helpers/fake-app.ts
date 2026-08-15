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

  notifyQueue(count: number): void {
    this.queues.push(count)
  }

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
  showQueuePicker(rows: readonly import('../../src/view/components/filterable-picker.ts').PickerRow[], onPicked: (value: string | null) => void): void {
    this.queueRows.push([...rows])
    this.queuePicked = onPicked
  }
  queuePicked: ((value: string | null) => void) | undefined

  showForkPicker(items: readonly SessionChoice[]): void {
    this.forkPoints = [...items]
  }

  toasts: Array<{ text: string; tone: string }> = []
  toast(text: string, tone: 'info' | 'error' | 'success' = 'info'): void {
    this.toasts.push({ text, tone })
  }

  /** The most recent rendered document (last render wins). */
  get last(): ViewDocument {
    return this.rendered[this.rendered.length - 1]
  }

  questions: ApprovalQuestion[] = []

  async askDialog(question: ApprovalQuestion): Promise<ApprovalAnswer> {
    this.questions.push(question)
    return { picked: this.dialogAnswer ?? question.options[0] ?? 'typed-answer', reason: 'picked' }
  }

  /** Drive the input handler as if the user submitted text. */
  input(text: string): void {
    if (this.handlers === undefined) throw new Error('FakeApp.input before start')
    this.handlers.onInput(text)
  }
}
