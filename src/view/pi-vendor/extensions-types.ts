/**
 * Trimmed type shim for the vendored pi components: only the names the
 * vendored files import from pi's core/extensions/types.ts, defined
 * structurally against pi-tui/pi-ai types. Compile-time only — the runtime
 * components stay verbatim.
 * @module dsh-tui-app/view/pi-vendor/extensions-types
 */

import type { Component } from '@earendil-works/pi-tui'
import type { Theme } from '../theme/theme.ts'

export interface MarkdownTransformContext {
  messageType: 'user' | 'assistant' | 'assistant-thinking'
  isStreaming: boolean
  availableWidth: number
}

export type MarkdownTransformer = (markdown: string, context: MarkdownTransformContext) => string

export interface WorkingIndicatorOptions {
  frames?: string[]
  intervalMs?: number
}

export interface ToolRenderResultOptions {
  expanded: boolean
  isPartial: boolean
}

export interface ToolRenderContext<TState = unknown, TArgs = unknown> {
  args: TArgs
  toolCallId: string
  invalidate: () => void
  lastComponent: Component | undefined
  state: TState
  cwd: string
  executionStarted: boolean
  argsComplete: boolean
  isPartial: boolean
  expanded: boolean
  showImages: boolean
  isError: boolean
}

export interface AgentToolResult<TDetails = unknown> {
  toolCallId?: string
  toolName?: string
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
  isError?: boolean
  details?: TDetails
}

export type ToolExecutionMode = 'sequential' | 'parallel'

export interface ToolDefinition<TParams = unknown, TDetails = unknown, TState = unknown> {
  name: string
  label: string
  description: string
  parameters?: TParams
  renderShell?: 'default' | 'self'
  renderCall?: (args: TParams, theme: Theme, context: ToolRenderContext<TState, TParams>) => Component
  renderResult?: (
    result: AgentToolResult<TDetails>,
    options: ToolRenderResultOptions,
    theme: Theme,
    context: ToolRenderContext<TState, TParams>,
  ) => Component
  execute?: (...args: unknown[]) => Promise<AgentToolResult<TDetails>>
}
