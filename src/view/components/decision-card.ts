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
import { bg, bold, fg } from '../../app/pi/color.ts'
import { strings } from '../strings.ts'

/** Pad/truncate one line to the inner width. */
function padLine(line: string, inner: number): string {
  const visible = line.length
  if (visible > inner) return line.slice(0, inner)
  return line + ' '.repeat(inner - visible)
}

export class DecisionCard implements Component {
  /** Cursor over the combined list: options first, then footer entries. */
  selectedIndex = 0
  /** Multi-select toggles, keyed by option index (never footer entries). */
  selectedOptions = new Set<number>()

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
  ) {}

  /** Number of selectable rows (options + footer entries). */
  get entryCount(): number {
    return this.options.length + this.footerEntries.length
  }

  invalidate(): void {
    // Pure render over current state.
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

    for (let i = 0; i < this.options.length; i++) {
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

    for (let i = 0; i < this.footerEntries.length; i++) {
      const entry = this.footerEntries[i]
      const index = this.options.length + i
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
