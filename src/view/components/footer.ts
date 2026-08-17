/**
 * The fixed status area UNDER the input line: the session stats strip
 * (web composer.dock StatsLine parity) on the first row, and the live
 * facts row (model · ctx pressure · cwd · message/token counts) on the
 * second. Keyboard shortcuts deliberately do NOT render here — they live
 * in `/hotkeys` (help command) only.
 * @module dsh-tui-app/view/components/footer
 */

import { truncateToWidth } from '@earendil-works/pi-tui'
import type { Component } from '@earendil-works/pi-tui'
import { fg } from '../../app/pi/color.ts'
import type { ViewDocument } from '../../document/document.ts'

/** What the footer should emphasise in this frame. */
export interface FooterContext {
  /** Model context window in tokens, when known (drives the ctx %). */
  contextWindow?: number
  /** The active model (`provider/model`), shown in the footer (pi/cc style). */
  model?: string
}

/** Compact token/message counters (pi's formatTokens style). */
function compact(count: number): string {
  if (count < 1000) return String(count)
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`
  return `${Math.round(count / 1000)}k`
}

export class FooterLine implements Component {
  private line = ''

  /**
   * Recompute both fixed rows from the document and the workspace label.
   * @param statsLine - the session stats strip (web composer.dock parity),
   *   computed by the caller from `statsStrip(doc, strings())`; may be
   *   empty before any turn settles.
   */
  set(doc: ViewDocument, workspace: string, statsLine: string, context: FooterContext = {}): boolean {
    let input = 0
    let output = 0
    let cacheRead = 0
    let messages = 0
    for (const entry of doc.entries) {
      if (entry.kind === 'user') messages++
      else if (entry.kind === 'assistant') {
        messages++
        input += entry.usage?.inputTokens ?? 0
        output += entry.usage?.outputTokens ?? 0
        cacheRead += entry.usage?.cacheReadTokens ?? 0
      }
    }
    const modelPart = context.model === undefined || context.model === ''
      ? ''
      : `${fg('cyan')(context.model)} · `
    // Model and the pressure meter lead (pi/cc style: the live facts stay
    // visible when the cwd path truncates the tail on narrow terminals).
    let facts = modelPart
    if (context.contextWindow !== undefined && context.contextWindow > 0) {
      const used = input + output
      const pct = Math.min(99, Math.round((used / context.contextWindow) * 100))
      const tone = pct >= 80 ? 'error' : pct >= 60 ? 'warning' : 'text'
      const filled = Math.round((pct / 100) * 10)
      // CC-07: 10 段压力条按来源分段——cache 命中段 info 色（复用已有上下文，
      // 便宜），新 surface 段用压力色（贵）；一眼看出压力的构成。
      const cacheFilled = used > 0 ? Math.min(filled, Math.round((cacheRead / used) * 10)) : 0
      let bar = ''
      for (let i = 0; i < 10; i++) {
        bar += i < cacheFilled
          ? fg('info')('▓')
          : i < filled
            ? fg(tone)('▓')
            : fg('dim')('░')
      }
      facts += `${fg(tone)(`ctx ${pct}%`)} ${bar} · `
    }
    facts += `${fg('muted')(workspace)} · ${fg('text')(`${messages} msgs`)} · ${fg('text')(`in ${compact(input)}`)} ${fg('text')(`out ${compact(output)}`)}`
    const next = statsLine === '' ? facts : `${fg('dim')(statsLine)}\n${facts}`
    if (next === this.line) return false
    this.line = next
    return true
  }

  invalidate(): void {
    // No cached state to invalidate.
  }

  render(width: number): string[] {
    return this.line.split('\n').map(line => truncateToWidth(line, width))
  }
}
