/**
 * Keyboard-only expand/collapse (pi-style): the click hit-testing is gone —
 * the ▸/▾/⏎ icons are pure status markers and every toggle rides Enter on
 * the focused entry. This spec drives the components' handleInput directly,
 * the same path the Tab focus cycle feeds.
 */

import { describe, expect, it } from 'vitest'
import type { TUI } from '@earendil-works/pi-tui'
import type { AssistantMessage } from '@earendil-works/pi-ai'
import { FocusableFrame } from '../src/view/components/focus-frame.ts'
import { CollapsibleMessage } from '../src/view/components/collapsible-message.ts'
import { FocusableToolCard } from '../src/view/components/tool-card.ts'
import { FocusableRetryRow } from '../src/view/components/retry-row.ts'
import { ExpandableNoticeView } from '../src/view/components/notice-view.ts'
import { AssistantMessageComponent } from '../src/view/pi-vendor/assistant-message.ts'
import { RetryStatusIndicator } from '../src/view/pi-vendor/status-indicator.ts'
import { ToolExecutionComponent } from '../src/view/pi-vendor/tool-execution.ts'

const noTui = { requestRender: () => {} } as unknown as TUI

/** Strip SGR sequences so text assertions see the visible content. */
const strip = (lines: string[]): string => lines.map(line => line.replace(/\x1b\[[0-9;]*m/g, '')).join('\n')

/** A message carrying thinking blocks plus a visible answer. */
function thinkingMessage(): AssistantMessage {
  return {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'secret reasoning' },
      { type: 'text', text: 'final answer' },
    ],
    api: 'dsh', provider: 'pi-ai', model: 'x',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: 'stop', timestamp: Date.now(),
  } as AssistantMessage
}

function toolCard(): FocusableToolCard {
  const inner = new ToolExecutionComponent('bash', 'c1', '{}', { showImages: false }, undefined, noTui, '/tmp')
  inner.markExecutionStarted()
  inner.setArgsComplete()
  inner.updateResult({ kind: 'tool-result', content: [{ type: 'text', text: 'ok' }], isError: false } as never)
  return new FocusableToolCard(inner)
}

describe('keyboard expand/collapse (no mouse listening)', () => {
  it('toggles a hidden thinking block with Enter on the focused message frame', () => {
    // hideThinkingBlock=true: the message renders the collapsed label.
    const message = new AssistantMessageComponent(thinkingMessage(), true)
    const frame = new FocusableFrame(message, '助手回复')
    const before = strip(frame.render(80))
    expect(before).toContain('Thinking...')
    expect(before).not.toContain('secret reasoning')
    // The ▸ status icon marks the hidden state; Enter is the toggle.
    expect(before).toContain('▸')
    expect(message.hasHiddenThinking()).toBe(true)

    frame.handleInput('\r')
    const after = strip(frame.render(80))
    expect(after).toContain('secret reasoning')
    expect(after).not.toContain('Thinking...')
    expect(message.isThinkingExpanded()).toBe(true)
    expect(message.hasHiddenThinking()).toBe(false)

    frame.handleInput('\r')
    expect(message.hasHiddenThinking()).toBe(true)
  })

  it('ignores Enter on a message frame without hidden thinking', () => {
    const plain = new AssistantMessageComponent({ ...thinkingMessage(), content: [{ type: 'text', text: 'just text' }] } as AssistantMessage, true)
    const frame = new FocusableFrame(plain, '助手回复')
    frame.handleInput('\r')
    expect(plain.isThinkingExpanded()).toBe(false)
  })

  it('toggles the tool card result view with Enter', () => {
    const card = toolCard()
    expect(card.isExpanded).toBe(false)
    card.handleInput('\r')
    expect(card.isExpanded).toBe(true)
    card.handleInput('\r')
    expect(card.isExpanded).toBe(false)
  })

  it('toggles the collapsed long-message fold with Enter', () => {
    const long = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n')
    const inner = new AssistantMessageComponent({ content: [{ type: 'text', text: long }] } as never)
    const view = new CollapsibleMessage(inner, long)
    view.handleInput('\r') // fold
    const folded = strip(view.render(80))
    expect(folded).toContain('line 0')
    expect(folded).toContain('还有 8 行')
    expect(folded).not.toContain('line 19')
    view.handleInput('\r') // unfold: the inner message renders the full text
    expect(strip(view.render(80))).toContain('line 19')
  })

  it('reveals the retry failure reason with Enter', () => {
    const inner = new RetryStatusIndicator(noTui, 1, 3, 0)
    const view = new FocusableRetryRow(inner, { code: 'TIMEOUT', message: 'upstream timed out' })
    expect(strip(view.render(80))).not.toContain('upstream timed out')
    view.handleInput('\r')
    expect(strip(view.render(80))).toContain('TIMEOUT: upstream timed out')
    view.handleInput('\r')
    expect(strip(view.render(80))).not.toContain('upstream timed out')
  })

  it('expands the injected-context notice body with Enter', () => {
    const view = new ExpandableNoticeView({
      kind: 'notice', id: 'n1', text: '注入 · workspace context', tone: 'info',
      detail: 'cwd: /tmp/ws\nfiles: 3',
    })
    expect(strip(view.render(80))).not.toContain('files: 3')
    view.handleInput('\r')
    expect(strip(view.render(80))).toContain('files: 3')
    view.handleInput('\r')
    expect(strip(view.render(80))).not.toContain('files: 3')
  })

  it('keeps the ⏎ icon as a pure status marker on focused cards', () => {
    const card = toolCard()
    card.focused = true
    const lines = card.render(80)
    // The affordance line names the keyboard toggle, never a click.
    expect(strip(lines)).toContain('⏎ 展开/收起')
  })
})
