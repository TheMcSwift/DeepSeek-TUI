/**
 * A focusable wrapper around plain message views (user/assistant/notice/
 * approval): it joins the Tab focus cycle so every transcript row is
 * keyboard-reachable, and the focused state renders an affordance line —
 * the TUI's stand-in for web hover chrome (T3④). Enter on a focused
 * assistant message toggles its hidden thinking block (pi-style keyboard
 * expansion); other frames have no Enter action — they mark position for
 * search jumps and focused feedback.
 * @module dsh-tui-app/view/components/focus-frame
 */

import { matchesKey, truncateToWidth } from '@earendil-works/pi-tui'
import type { Component, Focusable } from '@earendil-works/pi-tui'
import { fg } from '../../app/pi/color.ts'
import { AssistantMessageComponent } from '../pi-vendor/assistant-message.ts'

export class FocusableFrame implements Component, Focusable {
  focused = false

  constructor(public inner: Component, private readonly label: string) {}

  /** Swap the wrapped view (streaming updates rebuild the assistant view). */
  setInner(inner: Component): void {
    this.inner = inner
    this.invalidate()
  }

  handleInput(data: string): void {
    // Enter expands AND collapses this message's thinking block — the
    // keyboard counterpart of the ▸/▾ status icon (no mouse listening).
    if (matchesKey(data, 'enter') && this.inner instanceof AssistantMessageComponent
      && (this.inner.hasHiddenThinking() || this.inner.isThinkingExpanded())) {
      this.inner.toggleThinkingExpanded()
    }
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
