/**
 * Approval rendering: a one-line record in the document flow plus the overlay
 * question dialog (pi's SelectList visual language). Shared by both DSH seams
 * — the approval/request waterfall and the userQuestions provider.
 * @module dsh-tui-app/view/components/approval-view
 */

import { Input, Text, truncateToWidth, matchesKey } from '@earendil-works/pi-tui'
import type { Component, Focusable, TUI } from '@earendil-works/pi-tui'
import { fg } from '../../app/pi/color.ts'
import { DecisionCard } from './decision-card.ts'
import { strings } from '../strings.ts'
import type { ApprovalEntry } from '../../document/document.ts'

/**
 * The free-text dialog's own focusable panel: renders title + input + hint.
 * showOverlay focuses THIS component, so hide() can restore the previous
 * focus by identity (focusing an inner child breaks pi-tui's restore check).
 */
class DialogPanel implements Component, Focusable {
  focused = false

  constructor(
    private readonly title: Text,
    private readonly control: Input,
    private readonly hint: Text,
  ) {}

  handleInput(data: string): void {
    this.control.handleInput(data)
  }

  invalidate(): void {
    this.title.invalidate()
    this.control.invalidate()
    this.hint.invalidate()
  }

  render(width: number): string[] {
    return [
      ...this.title.render(width),
      ...this.control.render(width),
      this.hint.render(width)[0] ?? '',
    ]
  }
}

/** The collapsed approval record shown inside the transcript. */
export class ApprovalEntryView implements Component {
  private entry: ApprovalEntry

  constructor(entry: ApprovalEntry) {
    this.entry = entry
  }

  setEntry(entry: ApprovalEntry): void {
    this.entry = entry
  }

  invalidate(): void {
    // No cached state to invalidate.
  }

  render(width: number): string[] {
    const entry = this.entry
    const state = entry.state === 'pending'
      ? fg('accent')('⏳ approval')
      : entry.outcome === 'allowed-once' ? fg('success')('✓ allowed')
        : entry.outcome === 'rejected' ? fg('error')('✗ rejected')
          : fg('muted')(entry.outcome ?? 'decided')
    const detail = entry.reason !== undefined ? ` — ${entry.reason}` : ''
    return [truncateToWidth(`${state} ${fg('toolTitle')(entry.toolName)}${fg('muted')(detail)}`, width)]
  }
}

/** One question the surface asks the user. */
export interface ApprovalQuestion {
  title: string
  detail?: string
  options: string[]
  /** Per-option description lines (web ui-user-questions `description`). */
  optionDescriptions?: Array<string | undefined>
  /** Render `detail` as Markdown (plan reviews carry a full plan). */
  detailMarkdown?: boolean
  /** The option label that approves (plan-review intent): rendered with a ✔. */
  approveLabel?: string
  /** Title icon: ⚠ for permissions, ？ for questions (cc style). */
  icon?: string
  /** More than one option may be selected; Enter confirms the set. */
  multiSelect?: boolean
  /** Group heading (web ui-user-questions `header`). */
  header?: string
  /** `i / n` progress marker when part of a multi-question request. */
  progress?: { index: number; total: number }
  /** Footer entry label that skips the question; omitted = not skippable. */
  skipLabel?: string
  /** Footer entry label that returns to the previous question. */
  backLabel?: string
}

export interface ApprovalAnswer {
  picked?: string
  /** Multi-select: the confirmed option labels. */
  pickedMultiple?: string[]
  reason: 'picked' | 'cancelled' | 'timeout'
  /** True when the user chose the skip entry. */
  skipped?: boolean
  /** True when the user chose the back entry. */
  back?: boolean
}

/**
 * Present a question as a NON-capturing decision card (cc/pi style): the card
 * renders above the composer, arrow keys move the selection, Enter confirms,
 * Esc cancels — and the composer keeps working (input queues as usual).
 * Free-text questions (no options) keep a capturing Input dialog because they
 * need the editor's caret/IME. Resolves on selection, Escape, abort, or the
 * timeout (fail-closed mapping is the caller's concern).
 */
export function presentApprovalDialog(
  tui: TUI,
  question: ApprovalQuestion,
  signal: AbortSignal | undefined,
  timeoutMs = 120_000,
  width = 72,
  icon = '？',
): Promise<ApprovalAnswer> {
  return new Promise((resolve) => {
    const title = question.title
    // Markdown details (plan reviews) are capped: a full plan can run a
    // hundred lines, far past the card's height.
    const detailLines = question.detail !== undefined && question.detail !== ''
      ? question.detail.split('\n').slice(0, 12)
      : []

    let settled = false
    let handle: { hide(): void } | undefined
    let removeListener: (() => void) | undefined
    const settle = (answer: ApprovalAnswer): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      removeListener?.()
      handle?.hide()
      resolve(answer)
    }
    const onAbort = (): void => settle({ reason: 'cancelled' })
    const timer = setTimeout(() => settle({ reason: 'timeout' }), timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })

    // Shared eyebrow (`i / n` progress · group header) for both dialog forms.
    const progressLabel = question.progress !== undefined
      ? strings().questionProgress(question.progress.index, question.progress.total)
      : undefined
    const eyebrow = [progressLabel, question.header].filter(Boolean).join(' · ')

    if (question.options.length > 0) {
      const footerEntries = [
        ...(question.backLabel !== undefined ? [question.backLabel] : []),
        ...(question.skipLabel !== undefined ? [question.skipLabel] : []),
      ]
      const card = new DecisionCard(
        title,
        detailLines,
        question.options,
        question.optionDescriptions,
        question.approveLabel,
        icon,
        question.multiSelect === true,
        progressLabel,
        question.header,
        footerEntries,
      )
      // cc-style: the card hugs the left margin above the composer.
      handle = tui.showOverlay(card, {
        anchor: 'bottom-left', offsetY: -6, width, maxHeight: '40%',
        nonCapturing: true,
      })
      const optionCount = question.options.length
      const settleEntry = (index: number): void => {
        if (index < optionCount) {
          if (question.multiSelect === true) {
            // Multi-select: toggling the highlighted option; Enter confirms.
            card.selectedOptions.has(index)
              ? card.selectedOptions.delete(index)
              : card.selectedOptions.add(index)
            tui.requestRender()
            return
          }
          settle({ picked: question.options[index], reason: 'picked' })
          return
        }
        const footer = footerEntries[index - optionCount]
        if (footer === question.backLabel) settle({ reason: 'picked', back: true })
        else if (footer === question.skipLabel) settle({ reason: 'picked', skipped: true })
      }
      removeListener = tui.addInputListener((data: string) => {
        // Number keys pick the option directly (cc parity); in multi-select
        // mode they toggle the option in the confirmed set instead.
        if (data.length === 1 && data >= '1' && data <= '9') {
          const index = Number(data) - 1
          if (index < optionCount) {
            if (question.multiSelect === true) {
              card.selectedOptions.has(index)
                ? card.selectedOptions.delete(index)
                : card.selectedOptions.add(index)
              tui.requestRender()
              return { consume: true }
            }
            settle({ picked: question.options[index], reason: 'picked' })
            return { consume: true }
          }
          return undefined
        }
        // Space toggles the highlighted option in multi-select mode.
        if (question.multiSelect === true && data === ' ') {
          if (card.selectedIndex < optionCount) {
            card.selectedOptions.has(card.selectedIndex)
              ? card.selectedOptions.delete(card.selectedIndex)
              : card.selectedOptions.add(card.selectedIndex)
            tui.requestRender()
            return { consume: true }
          }
          return undefined
        }
        if (matchesKey(data, 'up')) {
          card.selectedIndex = Math.max(0, card.selectedIndex - 1)
          tui.requestRender()
          return { consume: true }
        }
        if (matchesKey(data, 'down')) {
          card.selectedIndex = Math.min(card.entryCount - 1, card.selectedIndex + 1)
          tui.requestRender()
          return { consume: true }
        }
        if (matchesKey(data, 'enter')) {
          // Multi-select: Enter confirms the whole toggled set (numbers and
          // space toggle); footer entries confirm directly. An empty set is
          // ignored — stay open like the web's unanswered guard.
          if (question.multiSelect === true && card.selectedIndex < optionCount) {
            if (card.selectedOptions.size > 0) {
              const pickedMultiple = [...card.selectedOptions]
                .sort((left, right) => left - right)
                .map(index => question.options[index])
              settle({ pickedMultiple, reason: 'picked' })
            }
            return { consume: true }
          }
          settleEntry(card.selectedIndex)
          return { consume: true }
        }
        if (matchesKey(data, 'escape')) {
          settle({ reason: 'cancelled' })
          return { consume: true }
        }
        return undefined
      })
      return
    }

    // Free-text answer: a real input line with its own caret and IME
    // support — no options means the user composes the answer.
    const titleView = new Text(`${fg('accent')('▸')} ${fg('text')(eyebrow === '' ? question.title : `${eyebrow} — ${question.title}`)}`, 0, 0)
    const input = new Input()
    const hint = new Text(fg('dim')('输入回答 · Enter 提交 · Esc 取消'), 0, 0)
    const panel = new DialogPanel(titleView, input, hint)
    handle = tui.showOverlay(panel, { anchor: 'bottom-left', offsetY: -6, width, maxHeight: '40%' })
    input.onSubmit = (value) => { settle({ picked: value, reason: 'picked' }) }
    input.onEscape = () => settle({ reason: 'cancelled' })
  })
}
