/**
 * Focusable wrapper around the vendored ToolExecutionComponent: Enter toggles
 * the expanded result view, and the focused state renders an affordance line.
 * Tab cycles focus between the composer and the mounted cards (see the app).
 * B3: nested `tool/code-dispatch` sub-calls render as an indented tree under
 * the parent card (the web's ToolCallTree subCalls, terminal-flattened).
 * @module dsh-tui-app/view/components/tool-card
 */

import { matchesKey, truncateToWidth } from '@earendil-works/pi-tui'
import type { Component, Focusable } from '@earendil-works/pi-tui'
import { fg } from '../../app/pi/color.ts'
import type { ToolEntry } from '../../document/document.ts'
import { ToolExecutionComponent } from '../pi-vendor/tool-execution.ts'

export class FocusableToolCard implements Component, Focusable {
  focused = false
  private expanded = false
  private details = false
  private footer: string | undefined
  private children: readonly ToolEntry[] | undefined
  /** Toggle icon position from the last render (row 0 tail), for clicks. */
  private iconRow = 0
  private iconCol = 0

  constructor(public readonly inner: ToolExecutionComponent) {}

  /** One-line footer under the card (T3② wall time). */
  setFooter(text: string | undefined): void {
    this.footer = text
    this.invalidate()
  }

  /** The card's nested sub-dispatch tree (B3), re-set on each fold update. */
  setChildren(children: readonly ToolEntry[] | undefined): void {
    this.children = children
    this.invalidate()
  }

  /** True when the click lands on the small expand/collapse icon. */
  clickIcon(row: number, col: number): boolean {
    if (row !== this.iconRow) return false
    return col >= this.iconCol && col <= this.iconCol + 1
  }

  get isExpanded(): boolean {
    return this.expanded
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'enter')) {
      this.expanded = !this.expanded
      this.inner.setExpanded(this.expanded)
      this.inner.invalidate()
    }
    if (data === 'i') {
      this.details = !this.details
      this.invalidate()
    }
  }

  invalidate(): void {
    this.inner.invalidate()
  }

  /** One compact tree row per sub-call: state marker + name + args + output. */
  private renderChildren(width: number): string[] {
    if (this.children === undefined || this.children.length === 0) return []
    const lines: string[] = [truncateToWidth(`${fg('dim')('  ╭')} ${fg('accent')('子调用')}`, width)]
    const walk = (entries: readonly ToolEntry[], depth: number): void => {
      const indent = '  │ ' + '    '.repeat(depth)
      for (const child of entries) {
        const marker = child.state === 'running' ? fg('warning')('⏳')
          : child.state === 'error' ? fg('error')('✗')
            : fg('success')('✓')
        const args = child.arguments.trim() === '' ? '' : ` ${child.arguments.slice(0, 60)}`
        lines.push(truncateToWidth(`${indent}${marker} ${fg('toolTitle')(child.name)}${fg('muted')(args)}`, width))
        const text = child.output?.blocks
          .map(block => block.type === 'text' ? block.text : JSON.stringify(block))
          .join('\n')
          .split('\n')[0] ?? ''
        if (text !== '') lines.push(truncateToWidth(`${indent}   ${fg('muted')(text.slice(0, 80))}`, width))
        if (child.children !== undefined && child.children.length > 0) walk(child.children, depth + 1)
      }
    }
    walk(this.children, 0)
    lines.push(truncateToWidth(fg('dim')('  ╰'), width))
    return lines
  }

  render(width: number): string[] {
    const lines = [...this.inner.render(width)]
    // Small expand/collapse icon at the end of the card's first row —
    // the mouse toggle target, distinct from clicking the card body.
    this.iconRow = 0
    this.iconCol = Math.max(0, width - 1)
    if (lines.length > 0) {
      lines[0] = `${truncateToWidth(lines[0], Math.max(1, width - 2))}${fg('dim')('⏎')}`
    }
    if (this.footer !== undefined) lines.push(truncateToWidth(this.footer, width))
    if (this.focused && this.details) {
      // Raw-input detail view (B10): the web DetailsPanel's input column,
      // capped like the expanded injected rows.
      const rows = this.inner.getArgsJson().split('\n')
      lines.push(truncateToWidth(`${fg('dim')('  ╭')} ${fg('accent')('raw input')}`, width))
      for (const row of rows.slice(0, 12)) lines.push(truncateToWidth(`${fg('dim')('  │')} ${fg('muted')(row)}`, width))
      if (rows.length > 12) lines.push(truncateToWidth(fg('dim')(`  … 还有 ${rows.length - 12} 行`), width))
      lines.push(truncateToWidth(fg('dim')('  ╰'), width))
    }
    lines.push(...this.renderChildren(width))
    if (this.focused) {
      lines.push(truncateToWidth(fg('dim')('  ⏎ 展开/收起 · i 原始输入 · Tab 切换焦点 · Esc 返回输入'), width))
    }
    return lines
  }
}
