/**
 * The seam between the runner and the terminal surface. The pi-tui
 * implementation satisfies this interface; tests substitute a fake that
 * records renders and drives handlers without a terminal.
 * @module dsh-tui-app/app/terminal-app
 */

import type { ViewDocument } from '../document/document.ts'
import type { JobRow } from '../view/components/panels.ts'
import type { ApprovalAnswer, ApprovalQuestion } from '../view/components/approval-view.ts'

/** One row in the session picker. */
export interface SessionChoice {
  value: string
  label: string
  description?: string
  /** Mark the row as the currently active session. */
  current?: boolean
}

/** One row in the model picker. */
export interface ModelChoice {
  /** `provider/model` — the value the runner resolves. */
  value: string
  label: string
  description?: string
  /** Mark the row as the currently selected model. */
  current?: boolean
}

/** One row in the slash-command palette (T1①). */
export interface CommandChoice {
  /** Lowercase command name; the runner passes it to `commands.execute`. */
  value: string
  /** Display label: `/name <input hint>`. */
  label: string
  description?: string
  /** Synonym names that resolve to this command (`exit` → `/quit`). */
  aliases?: string[]
}

/** One row in the permission-preset picker. */
export interface PermissionChoice {
  /** The preset table key the runner passes to `permissionPresets.set`. */
  value: string
  label: string
  description?: string
  /** Mark the row as the preset currently effective in this session. */
  current?: boolean
}

/** A plugin session projection in the interactive select shape (K3). */
export interface ProjectionRow {
  /** The projection key (e.g. `permissions`). */
  key: string
  /** The currently effective value. */
  currentValue: string
  /** Every switchable option. */
  options: Array<{ value: string; name: string; description?: string }>
}

/** Static identity shown in the surface header. */
export interface SurfaceMeta {
  /** `provider/model` of the active agent. */
  model: string
  /** Short session identity (the runner may truncate). */
  session: string
  /** Working directory label, when useful. */
  workspace?: string
  /** Model context window in tokens, when the adapter reports one. */
  contextWindow?: number
  /** Parent session id when this session is a subagent/fork (E4 breadcrumb). */
  parentSession?: string
}

/** Callbacks the surface invokes for user actions. */
export interface TerminalAppHandlers {
  /** A submitted composer line. */
  onInput(text: string): void
  /** Esc while a turn is active (Claude Code style). */
  onInterrupt(): void
  /** The user asked to leave the TUI. */
  onQuit(): void
  /** Ctrl+R was pressed: the runner should gather sessions and open the picker. */
  onSessionPickerRequest?(): void
  /** The session picker's filter changed (debounced); fetch backend hits (H5). */
  onSessionSearchRequest?(query: string): void
  /** Ctrl+G was pressed: the runner should gather models and open the picker. */
  onModelPickerRequest?(): void
  /** A session was chosen from the picker, or `null` on cancel. */
  onSessionPicked(value: string | null): void
  /** A model was chosen from the picker, or `null` on cancel. */
  onModelPicked(value: string | null): void
  /** Ctrl+P was pressed: the runner should gather presets and open the picker. */
  onPermissionPickerRequest?(): void
  /** A permission preset was chosen, or `null` on cancel. */
  onPermissionPicked(value: string | null): void
  /** The user typed `/new`: start a fresh session in place. */
  onNewSessionRequest?(): void
  /** Ctrl+/ was pressed: gather the registered commands and open the palette. */
  onCommandPickerRequest?(): void
  /** A command was chosen (palette or slash line) with optional inline args. */
  onCommandPicked(name: string | null, rawInput?: string): void
  /** Ctrl+E while plan mode is active: leave plan mode now. */
  onExitPlanModeRequest?(): void
  /** Ctrl+W was pressed: switch the workspace directory (T2④). */
  onWorkspaceSwitchRequest?(): void
  /** Alt+Enter: steer the composer text into the running turn (T5②). */
  onSteerRequest?(text: string): void
  /** Esc while busy / Alt+Up: retrieve the last queued message (T5②). */
  onQueueRetrieveRequest?(): void
  /** A `!command` settled: output text + whether it hides from the model (T5①). */
  onShellResult(text: string, hidden: boolean): void
  /** Ctrl+Y was pressed: rate the focused reply (or the latest) (T4③). */
  onRateRequest?(): void
  /** Ctrl+B was pressed: gather fork points and open the picker (T2①). */
  onForkPickerRequest?(): void
  /** A fork point (user-message seq) was chosen, or `null` on cancel. */
  onForkPicked(seq: number | null): void
}

/** The terminal surface contract the runner drives. */
export interface TerminalApp {
  /** Mount the full-screen surface and wire the handlers. */
  start(handlers: TerminalAppHandlers, meta: SurfaceMeta): void
  /** Render one document snapshot (called on every committed event). */
  render(doc: ViewDocument): void
  /** Drop every message/tool view — the runner calls this before replaying a
   *  fresh or resumed session so stale views never leak across sessions. */
  reset(): void
  /** Tear the surface down and restore the terminal. */
  stop(): void
  /** Open the session picker overlay. */
  showSessionPicker(items: readonly SessionChoice[]): void
  /** Feed backend full-text search results into the open session picker (H5). */
  setSessionPickerRows(rows: readonly SessionChoice[]): void
  /** Open the model picker overlay. */
  showModelPicker(items: readonly ModelChoice[]): void
  /** Open the permission-preset picker overlay. */
  showPermissionPicker(items: readonly PermissionChoice[]): void
  /** Push the live plugin session projections (K3: idle chips + Ctrl+P). */
  setProjections(rows: readonly ProjectionRow[]): void
  /** Open the slash-command palette overlay (T1①). */
  showCommandPicker(items: readonly CommandChoice[]): void
  /** Push the command catalog the inline slash menu filters (cc/pi style). */
  setCommands(items: readonly CommandChoice[]): void
  /** Open the sectioned /hotkeys reference panel (G38 re-layout). */
  showHotkeys(): void
  /** Ask the human one question through an overlay dialog. */
  askDialog(question: ApprovalQuestion): Promise<ApprovalAnswer>
  /** Show the pending message queue length while a turn runs (T1⑤). */
  notifyQueue(count: number): void
  /** Show the session's background jobs (T1⑥). */
  showJobs(rows: readonly JobRow[]): void
  /** The document entry id holding focus, or null (T3④). */
  focusedEntryId(): string | null
  /** Put a retrieved queued message back into the composer (T5②). */
  restoreToEditor(text: string): void
  /** The runner switched the workspace; refresh path-bound views (T2④). */
  setWorkspace(path: string): void
  /** Open the fork-point picker overlay (T2①). */
  showForkPicker(items: readonly SessionChoice[]): void
  /** Open a generic single-column picker (queue dock E1, projections K3). */
  showQueuePicker(rows: readonly import('../view/components/filterable-picker.ts').PickerRow[], onPicked: (value: string | null) => void, title?: string): void
  /** Transient action feedback in the status slot (P2; deferred until idle). */
  toast(text: string, tone?: 'info' | 'error' | 'success'): void
  /** Suspend the alt screen and open `path` in $EDITOR, then resume (K2). */
  openExternalEditor(path: string): Promise<void>
  /** Copy plain text to the host clipboard via OSC 52 (best effort, K2). */
  copyText(text: string): void
}
