/**
 * A focusable wrapper around plain message views (user/assistant/notice/
 * approval): it joins the Tab focus cycle so every transcript row is
 * keyboard-reachable, and the focused state renders an affordance line —
 * the TUI's stand-in for web hover chrome (T3④). Frames have no Enter action;
 * they mark position for search jumps and focused feedback.
 * @module dsh-tui-app/view/components/focus-frame
 */

import { truncateToWidth } from '@earendil-works/pi-tui'
import type { Component, Focusable } from '@earendil-works/pi-tui'
import { fg } from '../../app/pi/color.ts'

export class FocusableFrame implements Component, Focusable {
  focused = false

  constructor(public inner: Component, private readonly label: string) {}

  /** Swap the wrapped view (streaming updates rebuild the assistant view). */
  setInner(inner: Component): void {
    this.inner = inner
    this.invalidate()
  }

  handleInput(_data: string): void {
    // No frame-local action; the affordance line only marks focus position.
  }

  invalidate(): void {
    this.inner.invalidate()
  }

  render(width: number): string[] {
    const lines = [...this.inner.render(width)]
    if (this.focused) {
      lines.push(truncateToWidth(`${fg('accent')('  ▸')} ${fg('dim')(`${this.label} · Esc 返回输入`)}`, width))
    }
    return lines
  }
}
