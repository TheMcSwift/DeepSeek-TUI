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
import { permissionDisplayName, permissionTone } from '../../app/pi/command-match.ts'
import type { ViewDocument } from '../../document/document.ts'

/** What the footer should emphasise in this frame. */
export interface FooterContext {
  /** Model context window in tokens, when known (drives the ctx %). */
  contextWindow?: number
  /** The active model (`provider/model`), shown in the footer (pi/cc style). */
  model?: string
  /**
   * The active model selection's reasoning effort display name（/effort 所选，
   * 或启动时继承的持久化选择）。紧跟在模型标识之后；未选时省略。
   */
  effort?: string
  /**
   * token-meter 的三段 context breakdown（G42）：system/tools/messages 各自
   * 的 token 估算。提供时压力条按三段分色；缺省回退 usage 求和的两段近似。
   */
  breakdown?: { systemTokens: number; toolsTokens: number; messageTokens: number }
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
    // Reasoning effort rides right after the model identity（模型属性跟随模型，
    // /effort 切换后由 runner meta 回填显示名）。
    const effortPart = context.effort === undefined || context.effort === ''
      ? ''
      : `${fg('muted')(context.effort)} · `
    // 权限预设跟随模型/effort（web composer 的 PermissionSelect chip 等价物）：
    // 按危险等级分色 + web 同款显示名（Workspace Write / Full access）。
    const preset = doc.permissionPreset
    const permissionPart = preset === undefined
      ? ''
      : `${permissionTone(preset)(permissionDisplayName(preset))} · `
    // Model and the pressure meter lead (pi/cc style: the live facts stay
    // visible when the cwd path truncates the tail on narrow terminals).
    let facts = modelPart + effortPart + permissionPart
    if (context.contextWindow !== undefined && context.contextWindow > 0) {
      // G42 提供 breakdown 时用量按其三段合计（token-meter 的估算口径）；
      // 否则按 usage 求和的折叠近似。
      const used = context.breakdown !== undefined
        ? context.breakdown.systemTokens + context.breakdown.toolsTokens + context.breakdown.messageTokens
        : input + output
      const pct = Math.min(99, Math.round((used / context.contextWindow) * 100))
      const tone = pct >= 80 ? 'error' : pct >= 60 ? 'warning' : 'text'
      const filled = Math.round((pct / 100) * 10)
      let bar: string
      if (context.breakdown !== undefined) {
        // G42: token-meter 三段 breakdown（system/tools/messages）按占比着色。
        const { systemTokens, toolsTokens, messageTokens } = context.breakdown
        const total = systemTokens + toolsTokens + messageTokens
        const segments = (count: number): number => total > 0 ? Math.min(filled, Math.round((count / total) * 10)) : 0
        const systemFilled = segments(systemTokens)
        const toolsFilled = Math.min(filled, systemFilled + segments(toolsTokens))
        bar = ''
        for (let i = 0; i < 10; i++) {
          bar += i < systemFilled
            ? fg('dim')('▓')
            : i < toolsFilled
              ? fg('info')('▓')
              : i < filled
                ? fg(tone)('▓')
                : fg('dim')('░')
        }
      } else {
        // CC-07: 两段近似——cache 命中段 info 色（复用已有上下文，便宜），
        // 新 surface 段用压力色（贵）。
        const cacheFilled = used > 0 ? Math.min(filled, Math.round((cacheRead / used) * 10)) : 0
        bar = ''
        for (let i = 0; i < 10; i++) {
          bar += i < cacheFilled
            ? fg('info')('▓')
            : i < filled
              ? fg(tone)('▓')
              : fg('dim')('░')
        }
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
