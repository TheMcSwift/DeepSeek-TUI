/**
 * runner 侧的事件/文档派生摘要（纯函数）：会话 picker 的相对时间、审批
 * 弹窗的命令富化（CC-02）、轨迹视图的单行摘要（B11/H31）以及文档工具树的
 * callId 定位。原内联在 index.ts，拆分后保持零 IO。
 * @module dsh-tui-app/control/summaries
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolEntry, ViewDocument, ViewEntry } from '../document/document.ts'
import { strings } from '../view/strings.ts'

/** Human-friendly age for the session picker (T3⑤). */
export function relTime(at: number): string {
  const minute = 60_000
  const hour = 3_600_000
  const day = 86_400_000
  const delta = Date.now() - at
  if (delta < minute) return '刚刚'
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`
  if (delta < 7 * day) return `${Math.floor(delta / day)} 天前`
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 在文档流（含工具卡的递归子调用树）里按 callId 定位工具调用。 */
export function findToolCall(entries: readonly ViewEntry[], callId: string): ToolEntry | undefined {
  for (const entry of entries) {
    if (entry.kind === 'tool') {
      if (entry.callId === callId) return entry
      const child = entry.children !== undefined ? findToolCall(entry.children, callId) : undefined
      if (child !== undefined) return child
    }
  }
  return undefined
}

/**
 * A3 `/context` 报告：注入行（`notice` 且 id 以 `inject:` 开头）按 kind
 * 分组（skill-catalog / agent-instructions / goal / plugin / …），组内取
 * 正文首行截断预览；无注入时返回空态文案。纯函数（fold 产物输入）。
 */
export function contextReport(doc: Pick<ViewDocument, 'entries'>): { title: string; body: string } {
  const injections = doc.entries.filter(
    (entry): entry is Extract<ViewEntry, { kind: 'notice' }> =>
      entry.kind === 'notice' && entry.id.startsWith('inject:'),
  )
  if (injections.length === 0) return { title: strings().ctxTitle, body: strings().ctxEmpty }
  const groups = new Map<string, string[]>()
  for (const entry of injections) {
    // text 形如 `注入 · <label> — <preview>`；label 首段即注入 kind。
    const sep = entry.text.indexOf(' — ')
    const label = (sep === -1 ? entry.text : entry.text.slice(0, sep)).replace(/^注入 · /, '')
    const kind = label.split(' · ')[0] ?? 'inject'
    const body = entry.detail ?? entry.text
    const firstLine = body.split('\n').find(line => line.trim() !== '') ?? ''
    const preview = firstLine.length <= 60 ? firstLine : `${firstLine.slice(0, 59)}…`
    const lines = groups.get(kind) ?? []
    lines.push(preview)
    groups.set(kind, lines)
  }
  const body = [...groups.entries()]
    .map(([kind, lines]) => `【${kind}】\n${lines.map(line => `  ${line}`).join('\n')}`)
    .join('\n\n')
  return { title: `${strings().ctxTitle}（${injections.length}）`, body }
}

/** 文档工具调用 → 审批弹窗富化数据（CC-02）。 */
export function approvalContext(entry: ToolEntry | undefined): { commandText?: string; impactLines?: string[] } {  if (entry === undefined) return {}
  let args: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(entry.arguments)
    if (parsed !== null && typeof parsed === 'object') args = parsed as Record<string, unknown>
  } catch {
    // 非 JSON 参数按原文展示。
  }
  const clip = (text: string): string => (text.length > 300 ? `${text.slice(0, 300)}…` : text)
  // Shell 工具：正文就是命令本身，直接展示（Claude Code 权限弹窗的核心）。
  if (entry.name === 'bash' || entry.name === 'pwsh' || entry.name === 'shell') {
    const command = typeof args.command === 'string' ? args.command : typeof args.cmd === 'string' ? args.cmd : ''
    return command === '' ? { commandText: clip(entry.arguments) } : { commandText: clip(command) }
  }
  // 写类工具：影响文件行给出目标路径；其余按参数原文展示。
  if (entry.name === 'write' || entry.name === 'edit' || entry.name === 'str_replace_editor') {
    const path = typeof args.file_path === 'string' ? args.file_path : undefined
    return {
      commandText: clip(entry.arguments),
      ...path === undefined ? {} : { impactLines: [strings().permissionImpact(path)] },
    }
  }
  return { commandText: clip(entry.arguments) }
}

/**
 * 原始事件 → 轨迹行单行摘要（B11/H31）：核心事件类型给人类可读摘要
 * （消息正文/工具名与参数/usage），扩展事件类型（goal/approval/notice 等）
 * 走 JSON 摘要兜底。
 */
export function trajectorySummary(event: SessionEvent): string {
  const clip = (text: string): string => (text.length > 60 ? `${text.slice(0, 59)}…` : text)
  const data = event.data as unknown as Record<string, unknown>
  switch (event.type) {
    case 'turn/start':
      return `turn ${String(data.turn)} 开始`
    case 'turn/end':
      return `turn ${String(data.turn)} 结束（${String(data.reason)}）`
    case 'step/start':
      return `turn ${String(data.turn)} · step ${String(data.step)} 开始`
    case 'step/end':
      return `turn ${String(data.turn)} · step ${String(data.step)} 结束`
    case 'user/message': {
      const content = (data.content as Array<{ type: string; text?: string }> | undefined) ?? []
      const text = content.map(block => block.type === 'text' ? (block.text ?? '') : `[${block.type}]`).join(' ')
      return clip(text.trim())
    }
    case 'assistant/message': {
      const message = data.message as { content?: Array<{ type: string; text?: string }> }
      const content = message.content ?? []
      const text = content.map(block => block.type === 'text' ? (block.text ?? '') : `[${block.type}]`).join(' ')
      const usage = data.usage as { inputTokens?: number; outputTokens?: number } | undefined
      return clip(`${text.trim()}${usage === undefined ? '' : ` · in ${usage.inputTokens ?? 0} out ${usage.outputTokens ?? 0}`}`)
    }
    case 'tool/call':
      return clip(`${String(data.name)} ${String(data.arguments)}`)
    case 'tool/result': {
      const message = data.message as { content?: Array<{ type: string; text?: string }> } | undefined
      const first = message?.content?.[0]
      const text = first === undefined ? '' : first.type === 'text' ? (first.text ?? '') : `[${first.type}]`
      const error = data.error as { code: string } | undefined
      return clip(`${error === undefined ? 'ok' : `✗ ${error.code}`} ${text}`)
    }
    case 'todo/write':
      return `${(data.todos as unknown[]).length} 项 todo`
    default:
      return clip(JSON.stringify(data))
  }
}
