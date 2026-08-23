/**
 * A12 `/btw` 侧问面板：无工具单轮 LLM 回答的瞬态浮层——流式追加正文、
 * `c` 复制全文、Esc 关闭；不进会话日志、不计入文档流（与决策卡同类
 * 瞬态 UI 状态，遵守 AGENTS.md 的单向数据流例外）。
 * @module dsh-tui-app/view/components/btw-panel
 */

import { matchesKey, truncateToWidth } from '@earendil-works/pi-tui'
import type { Component, Focusable } from '@earendil-works/pi-tui'
import { bold, fg } from '../../app/pi/color.ts'
import { strings } from '../strings.ts'

/** 面板内最多显示的正文行数（滚出部分被截断——侧问是快照式答案）。 */
const BODY_LINE_CAP = 16

export class BtwPanel implements Component, Focusable {
  focused = false
  private text = ''

  constructor(
    private readonly question: string,
    private readonly onClose: () => void,
  ) {}

  append(delta: string): void {
    this.text += delta
  }

  copyText(): string {
    return this.text
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape') || data === 'q') {
      this.onClose()
      return
    }
    if (data === 'c') {
      this.onCopy?.()
    }
  }

  private onCopy?: () => void

  setCopyHandler(handler: () => void): void {
    this.onCopy = handler
  }

  invalidate(): void {
    // Pure render over the accumulated text.
  }

  render(width: number): string[] {
    const lines: string[] = [
      `${fg('accent')('▸')} ${bold(fg('text')(strings().btwTitle))} · ${fg('muted')(truncateToWidth(this.question, Math.max(0, width - 18)))}`,
      fg('borderMuted')('─'.repeat(Math.max(0, width))),
    ]
    const body = this.text.split('\n').slice(0, BODY_LINE_CAP)
    for (const line of body) {
      lines.push(truncateToWidth(fg('text')(line), width))
    }
    if (this.text.split('\n').length > BODY_LINE_CAP) {
      lines.push(truncateToWidth(fg('dim')(`  … 还有 ${this.text.split('\n').length - BODY_LINE_CAP} 行`), width))
    }
    lines.push(truncateToWidth(fg('dim')(strings().btwHint), width))
    return lines
  }
}
