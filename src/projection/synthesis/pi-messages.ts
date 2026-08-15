/**
 * Synthesis: DSH document entries → the pi-ai data shapes the vendored
 * components consume. Pure data construction — the pi components stay
 * verbatim and the DSH runtime stays the only controller.
 * @module dsh-tui-app/projection/synthesis/pi-messages
 */

import type {
  Api,
  AssistantMessage,
  ProviderId,
  TextContent,
  ThinkingContent,
  Usage,
} from '@earendil-works/pi-ai'
import type { AssistantEntry, ToolEntry } from '../../document/document.ts'

/** Build the pi-ai assistant message a DSH assistant entry projects to. */
export function synthesizeAssistantMessage(entry: AssistantEntry, provider: string, model: string): AssistantMessage {
  const content: (TextContent | ThinkingContent)[] = [
    ...entry.thinking.map(thinking => ({ type: 'thinking' as const, thinking })),
    ...entry.text === '' ? [] : [{ type: 'text' as const, text: entry.text }],
  ]
  const input = entry.usage?.inputTokens ?? 0
  const output = entry.usage?.outputTokens ?? 0
  const usage: Usage = {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  }
  return {
    role: 'assistant',
    content,
    api: 'dsh' as Api,
    provider: provider as ProviderId,
    model,
    usage,
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

/** The pi tool-result shape for a completed DSH tool entry. */
export function synthesizeToolResult(entry: ToolEntry): {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
  details: { meta?: unknown } | undefined
  isError: boolean
} {
  return {
    content: (entry.output?.blocks ?? []) as Array<{ type: string; text?: string; data?: string; mimeType?: string }>,
    details: entry.meta === undefined ? undefined : { meta: entry.meta },
    isError: entry.state === 'error',
  }
}
