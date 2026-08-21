/**
 * The decision card (cc/pi style): a bordered question card rendered as a
 * NON-focus-stealing overlay above the composer. Arrow keys move the
 * selection, Enter confirms, Esc cancels — and the composer keeps working
 * the whole time (messages queue as usual). pi renders these in the editor
 * area; the card floats just above the composer here, which reads the same.
 *
 * Web parity (ui-user-questions QuestionComposer): single- and multi-select
 * questions, per-option descriptions, group headers, `i / n` progress, and
 * the `上一题`/`跳过本题` footer entries (web locale copy reused verbatim).
 * @module dsh-tui-app/view/components/decision-card
 */

import type { Component } from '@earendil-works/pi-tui'
import { matchesKey } from '@earendil-works/pi-tui'
import { bg, bold, fg } from '../../app/pi/color.ts'
import { strings } from '../strings.ts'

/** Pad/truncate one line to the inner width. */
function padLine(line: string, inner: number): string {
  const visible = line.length
  if (visible > inner) return line.slice(0, inner)
  return line + ' '.repeat(inner - visible)
}

/** 选项窗口高度：超过时窗口跟随选中滚动，选中行永远可见。 */
const VISIBLE_OPTIONS = 6

export class DecisionCard implements Component {
  /** Cursor over the combined list: options first, then footer entries. */
  selectedIndex = 0
  /** Multi-select toggles, keyed by option index (never footer entries). */
  selectedOptions = new Set<number>()
  /** 选项窗口起点（超过 VISIBLE_OPTIONS 时窗口跟随选中滚动）。 */
  private optionOffset = 0
  /** Plan-review 反馈输入行（B11）：打字追加，随「继续规划」提交。 */
  feedback = ''
  /** 卡内错误提示行（如「批准不能附带反馈」）；空则不渲染。 */
  errorHint = ''

  constructor(
    private readonly title: string,
    private readonly detailLines: string[],
    private readonly options: string[],
    private readonly optionDescriptions: Array<string | undefined> | undefined,
    private readonly approveLabel: string | undefined,
    private readonly icon: string,
    private readonly multiSelect: boolean,
    private readonly progressLabel: string | undefined,
    private readonly header: string | undefined,
    private readonly footerEntries: string[],
    private readonly commandText: string | undefined = undefined,
    private readonly impactLines: string[] | undefined = undefined,
    /** 广义交互层：plain = 无边框纯文本（cc 式），boxed = 圆角卡（pi 式）。 */
    private readonly style: 'boxed' | 'plain' = 'boxed',
    /** Plan-review 专用：选项下方渲染反馈输入行（B11）。 */
    private readonly reviewInput: boolean = false,
  ) {}

  /** 反馈行在选中表里的位置（选项之后、footer 条目之前）；无反馈行时为 -1。 */
  get feedbackIndex(): number {
    return this.reviewInput ? this.options.length : -1
  }

  /** 可选中行数（选项 + 反馈行 + footer 条目）。 */
  get entryCount(): number {
    return this.options.length + (this.reviewInput ? 1 : 0) + this.footerEntries.length
  }

  /** 当前选中是否落在反馈输入行上。 */
  get onFeedback(): boolean {
    return this.selectedIndex === this.feedbackIndex
  }

  /** 追加一个可打印字符到反馈缓冲（B11；打字即进入反馈行）。 */
  typeFeedback(char: string): void {
    this.feedback += char
    this.selectedIndex = this.feedbackIndex
    this.errorHint = ''
  }

  /** 退格删掉反馈末尾字符。 */
  backspaceFeedback(): void {
    this.feedback = this.feedback.slice(0, -1)
  }

  /** 显示卡内错误提示（批准带反馈等）；渲染后由下一次按键清除。 */
  setErrorHint(text: string): void {
    this.errorHint = text
  }

  /** 方向键：选中在「选项 + 反馈行 + 底部条目」整表间循环（触底回首部，反之到尾部）。 */
  moveSelection(delta: number): void {
    const count = this.entryCount
    if (count <= 0) return
    this.selectedIndex = (this.selectedIndex + delta + count) % count
    this.revealSelection()
  }

  /** PgUp/PgDn：按选项窗口整页跳转（越界钳制在表两端）。 */
  page(delta: number): void {
    const count = this.entryCount
    if (count <= 0) return
    this.selectedIndex = Math.min(Math.max(0, this.selectedIndex + delta * VISIBLE_OPTIONS), count - 1)
    this.revealSelection()
  }

  /** 选中落在选项内时，滚动选项窗口使其始终可见（footer 条目在窗口下方常驻）。 */
  private revealSelection(): void {
    const maxStart = Math.max(0, this.options.length - VISIBLE_OPTIONS)
    if (this.selectedIndex < this.options.length) {
      if (this.selectedIndex < this.optionOffset) this.optionOffset = this.selectedIndex
      else if (this.selectedIndex >= this.optionOffset + VISIBLE_OPTIONS) {
        this.optionOffset = this.selectedIndex - VISIBLE_OPTIONS + 1
      }
    }
    this.optionOffset = Math.min(Math.max(0, this.optionOffset), maxStart)
  }

  invalidate(): void {
    // Pure render over current state.
  }

  /**
   * 覆盖层路由入口（app 的 hookAltScreen 把 PgUp/PgDn 直接喂给顶层覆盖层）：
   * 卡片是非捕获层（编辑器仍持有焦点），普通按键走 approval-view 的监听器，
   * 只有被视口处理无条件吞掉的翻页键经此路由。
   */
  handleInput(data: string): void {
    if (matchesKey(data, 'pageUp')) {
      this.page(-1)
      return
    }
    if (matchesKey(data, 'pageDown')) {
      this.page(1)
    }
  }

  render(width: number): string[] {
    const inner = Math.max(8, width - 2)
    const boxed = this.style === 'boxed'
    const frame = fg('borderAccent')
    const left = boxed ? `${frame('│')} ` : '  '
    const right = (): string => (boxed ? frame('│') : '')
    const blank = (): string | undefined => (boxed ? `${frame('│')}${' '.repeat(inner)}${frame('│')}` : undefined)
    const eyebrow = [this.progressLabel, this.header].filter(Boolean).join(' · ')
    const titleText = eyebrow === '' ? this.title : `${eyebrow} — ${this.title}`
    const titleLine = boxed
      ? `${frame('╭─')} ${bold(fg('text')(`${this.icon} ${titleText}`))} ${frame('─'.repeat(Math.max(0, inner - titleText.length - 4)) + '╮')}`
      : `${fg('accent')('▸')} ${bold(fg('text')(`${this.icon} ${titleText}`))}`
    const lines: string[] = [titleLine]

    for (const detail of this.detailLines.slice(0, 10)) {
      lines.push(`${left}${fg('muted')(padLine(detail, inner - 1))}${right()}`)
    }
    if (this.detailLines.length > 10) {
      lines.push(`${left}${fg('dim')(`… 其余 ${this.detailLines.length - 10} 行已省略`)}${right()}`)
    }
    // CC-02: the exact command being approved, highlighted between the reason
    // and the options (Claude Code shows the shell body in the permission
    // prompt); impact lines warn which files the call will touch.
    if (this.commandText !== undefined && this.commandText !== '') {
      const spacer = blank()
      if (spacer !== undefined) lines.push(spacer)
      lines.push(`${left}${fg('muted')(padLine(strings().permissionCommand, inner - 1))}${right()}`)
      const commandLines = this.commandText.split('\n').slice(0, 6)
      for (const commandLine of commandLines) {
        lines.push(`${left}${fg('toolTitle')(padLine(commandLine, inner - 1))}${right()}`)
      }
      if (this.commandText.split('\n').length > 6) {
        lines.push(`${left}${fg('dim')(padLine(`… 其余 ${this.commandText.split('\n').length - 6} 行已省略`, inner - 1))}${right()}`)
      }
    }
    for (const impact of this.impactLines ?? []) {
      lines.push(`${left}${fg('warning')(padLine(impact, inner - 1))}${right()}`)
    }
    const spacer = blank()
    if (spacer !== undefined) lines.push(spacer)

    // 选项窗口：超过 VISIBLE_OPTIONS 时窗口跟随选中滚动，两端给出余量提示
    // （与 settings/plugins 面板同约定）；footer 条目在窗口下方常驻。
    const maxStart = Math.max(0, this.options.length - VISIBLE_OPTIONS)
    const start = Math.min(Math.max(0, this.optionOffset), maxStart)
    const end = Math.min(start + VISIBLE_OPTIONS, this.options.length)
    if (start > 0) {
      lines.push(`${left}${fg('dim')(padLine(`↑ 还有 ${start} 条`, inner - 1))}${right()}`)
    }
    for (let i = start; i < end; i++) {
      const option = this.options[i]
      const isApprove = option === this.approveLabel
      const isSelected = this.multiSelect && this.selectedOptions.has(i)
      // cc-style numbered options; the number is display-only (the picked
      // value stays the exact option label). Multi-select marks the set.
      const marker = isSelected ? ' ☑' : isApprove ? ' ✓' : ''
      const label = `${i + 1}. ${option}${marker}`
      if (i === this.selectedIndex) {
        lines.push(`${left}${bg('selectedBg')(bold(fg('accent')(`❯ ${label}`)))}${' '.repeat(Math.max(0, inner - label.length - 3))}${right()}`)
      } else {
        lines.push(`${left}  ${fg('text')(padLine(label, inner - 3))}${right()}`)
      }
      // Option description renders as a dim continuation line (web's
      // description row; the TUI shows it inline instead of a tooltip).
      const description = this.optionDescriptions?.[i]
      if (description !== undefined && description !== '') {
        lines.push(`${left}  ${fg('dim')(padLine(description.slice(0, inner - 6), inner - 6))}${right()}`)
      }
    }
    if (end < this.options.length) {
      lines.push(`${left}${fg('dim')(padLine(`↓ 还有 ${this.options.length - end} 条`, inner - 1))}${right()}`)
    }

    // Plan-review 反馈输入行（B11）：选项下方、footer 条目之前；打字进入，
    // 随「继续规划」提交（custom 槽）；批准带反馈时报错提示。
    if (this.reviewInput) {
      const feedbackLabel = this.feedback === ''
        ? `❯ ${strings().reviewFeedbackEmpty}`
        : `❯ ${strings().reviewFeedback}：${this.feedback}`
      if (this.onFeedback) {
        lines.push(`${left}${bg('selectedBg')(bold(fg('accent')(padLine(feedbackLabel, inner - 3))))}${' '.repeat(Math.max(0, inner - feedbackLabel.length - 3))}${right()}`)
      } else {
        lines.push(`${left}${fg('text')(padLine(feedbackLabel, inner - 3))}${right()}`)
      }
      if (this.errorHint !== '') {
        lines.push(`${left}${fg('warning')(padLine(`⚠ ${this.errorHint}`, inner - 2))}${right()}`)
      }
    }

    for (let i = 0; i < this.footerEntries.length; i++) {
      const entry = this.footerEntries[i]
      const index = this.options.length + (this.reviewInput ? 1 : 0) + i
      const label = `— ${entry} —`
      if (index === this.selectedIndex) {
        lines.push(`${left}${bg('selectedBg')(bold(fg('accent')(`❯ ${label}`)))}${' '.repeat(Math.max(0, inner - label.length - 3))}${right()}`)
      } else {
        lines.push(`${left}  ${fg('dim')(padLine(label, inner - 3))}${right()}`)
      }
    }

    const tail = blank()
    if (tail !== undefined) lines.push(tail)
    const hint = this.multiSelect ? strings().multiPickHint : strings().pickHint
    lines.push(`${left}${fg('dim')(padLine(`↑/↓ 选择 · ${hint} · 输入照常排队`, inner - 1))}${right()}`)
    if (boxed) lines.push(`${frame('╰')}${'─'.repeat(inner)}${frame('╯')}`)
    return lines
  }
}
