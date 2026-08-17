/**
 * Focusable retry row: wraps the RetryStatusIndicator so the failure reason
 * (A12, web's expandable retry failure) can be revealed with Enter once Tab
 * focuses the row. The indicator line renders first; the failure detail
 * renders as dim lines below it while expanded.
 * @module dsh-tui-app/view/components/retry-row
 */

import { matchesKey, truncateToWidth } from '@earendil-works/pi-tui'
import type { Component, Focusable } from '@earendil-works/pi-tui'
import { fg } from '../../app/pi/color.ts'
import { RetryStatusIndicator } from '../pi-vendor/status-indicator.ts'

export class FocusableRetryRow implements Component, Focusable {
  focused = false
  private expanded = false

  constructor(
    public readonly inner: RetryStatusIndicator,
    private readonly failure: { code: string; message: string } | undefined,
  ) {}

  handleInput(data: string): void {
    if (matchesKey(data, 'enter') && this.failure !== undefined) {
      this.expanded = !this.expanded
    }
  }

  invalidate(): void {
    this.inner.invalidate()
  }

  render(width: number): string[] {
    const lines = [...this.inner.render(width)]
    // Expand status icon at the end of the indicator row.
    if (lines.length > 0 && this.failure !== undefined) {
      lines[0] = `${truncateToWidth(lines[0], Math.max(1, width - 2))}${fg('dim')('⏎')}`
    }
    if (this.expanded && this.failure !== undefined) {
      const reason = `${this.failure.code}: ${this.failure.message}`
      lines.push(truncateToWidth(`${fg('dim')('  ╭')} ${fg('error')('失败原因')}`, width))
      for (const row of reason.split('\n').slice(0, 8)) {
        lines.push(truncateToWidth(`${fg('dim')('  │')} ${fg('muted')(row)}`, width))
      }
      lines.push(truncateToWidth(fg('dim')('  ╰'), width))
    }
    if (this.focused && this.failure !== undefined) {
      lines.push(truncateToWidth(fg('dim')('  ⏎ 失败原因 · Tab 切换焦点 · Esc 返回输入'), width))
    }
    return lines
  }
}
