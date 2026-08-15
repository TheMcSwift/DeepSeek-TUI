/**
 * Click-to-expand hit-testing: row counting and click dispatch over the
 * mounted entry views (mouse parity for the web's ReasoningRow/tool cards).
 */

import { describe, expect, it } from 'vitest'
import type { TUI } from '@earendil-works/pi-tui'
import { CollapsibleMessage } from '../src/view/components/collapsible-message.ts'
import { FocusableToolCard } from '../src/view/components/tool-card.ts'
import { FocusableRetryRow } from '../src/view/components/retry-row.ts'
import { AssistantMessageComponent } from '../src/view/pi-vendor/assistant-message.ts'
import { RetryStatusIndicator } from '../src/view/pi-vendor/status-indicator.ts'
import { ToolExecutionComponent } from '../src/view/pi-vendor/tool-execution.ts'
import { clickableRows, clickEntryAt } from '../src/app/pi-tui-app.ts'
import type { Component } from '@earendil-works/pi-tui'

const noTui = { requestRender: () => {} } as unknown as TUI

function toolCard(name = 'bash', args = '{}', done = true): FocusableToolCard {
  const inner = new ToolExecutionComponent(name, 'c1', args, { showImages: false }, undefined, noTui, '/tmp')
  if (done) {
    inner.markExecutionStarted()
    inner.setArgsComplete()
    inner.updateResult({ kind: 'tool-result', content: [{ type: 'text', text: 'ok' }], isError: false } as never)
  }
  return new FocusableToolCard(inner)
}

describe('click hit-testing', () => {
  it('counts rows for expandable views and ignores inert ones', () => {
    const card = toolCard()
    expect(clickableRows(card, 100)).toBeGreaterThan(0)
    const collapsible = new CollapsibleMessage(
      new AssistantMessageComponent({ content: [{ type: 'text', text: 'hello' }] } as never),
      'line 1\nline 2',
    )
    expect(clickableRows(collapsible, 100)).toBeGreaterThan(0)
    // A bare, non-focusable component has no click target.
    expect(clickableRows(new AssistantMessageComponent(), 100)).toBe(0)
  })

  it('expands tool cards on click', () => {
    const card = toolCard()
    expect(card.isExpanded).toBe(false)
    card.render(80) // mount: icon lands on the row-0 tail (col 79)
    // The icon rides the row-0 tail; a body click does nothing.
    expect(clickEntryAt(card, 0, 0)).toBe(false)
    expect(clickEntryAt(card, 0, 79)).toBe(true)
    expect(card.isExpanded).toBe(true)
    expect(clickEntryAt(card, 0, 79)).toBe(true)
    expect(card.isExpanded).toBe(false)
  })

  it('expands collapsible messages on click', () => {
    const inner = new AssistantMessageComponent({ content: [{ type: 'text', text: 'hi' }] } as never)
    const view = new CollapsibleMessage(inner, 'a\nb')
    view.render(80) // mount: icon lands on the row-0 tail (col 79)
    // Default expanded; the row-0-tail icon folds it, again expands.
    expect(clickEntryAt(view, 0, 0)).toBe(false) // body click is inert
    expect(clickEntryAt(view, 0, 79)).toBe(true)
    expect(view.expanded).toBe(false)
    expect(clickEntryAt(view, 0, 79)).toBe(true)
    expect(view.expanded).toBe(true)
  })

  it('expands retry rows on click when a failure reason exists', () => {
    const indicator = new RetryStatusIndicator(noTui, 1, 3, 1000)
    const row = new FocusableRetryRow(indicator, { code: 'TIMEOUT', message: 'slow' })
    const before = row.render(80).length // mount: icon lands on col 79
    expect(clickEntryAt(row, 0, 0)).toBe(false) // body click is inert
    expect(clickEntryAt(row, 0, 79)).toBe(true)
    expect(row.render(80).length).toBeGreaterThan(before) // failure detail lines
  })

  it('expands a hidden thinking block on click and collapses it again', () => {
    const message = new AssistantMessageComponent(
      { content: [{ type: 'thinking', thinking: 'plan...' }, { type: 'text', text: 'done' }] } as never,
      true, // hide thinking blocks (global Ctrl+T state)
    )
    expect(message.hasHiddenThinking()).toBe(true)
    message.render(80) // mount: icon lands on the row-0 tail (col 79)
    expect(clickEntryAt(message, 0, 0)).toBe(false) // body click is inert
    expect(clickEntryAt(message, 0, 79)).toBe(true) // ▸ icon at the tail
    expect(message.hasHiddenThinking()).toBe(false)
    // The expanded block's content is now rendered (the hidden label is not).
    expect(message.render(80).join('\n')).toContain('plan...')
    expect(message.render(80).join('\n')).not.toContain('Thinking...')
    expect(clickEntryAt(message, 0, 79)).toBe(true)
    expect(message.hasHiddenThinking()).toBe(true)
  })

  it('leaves clicks on visible thinking blocks unconsumed', () => {
    const message = new AssistantMessageComponent(
      { content: [{ type: 'thinking', thinking: 'plan...' }, { type: 'text', text: 'done' }] } as never,
      false, // thinking already visible
    )
    expect(message.hasHiddenThinking()).toBe(false)
    message.render(80)
    expect(clickEntryAt(message, 0, 79)).toBe(false) // no toggle target
  })
})
