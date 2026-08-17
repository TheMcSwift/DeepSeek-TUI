/**
 * TUI 自有反馈 sidecar（T2②）：回复评价的持久化。service-backed 的
 * messageFeedback 栈需要 web profile 的 storage 插件，out-of-tree profile
 * 无法挂载（loader 只从 dsh 安装解析 bundle 行，见 GAP-ANALYSIS.md）——
 * 因此 TUI 把评价写进 `$DSH_HOME/tui-feedback.json` 并在回放时展示汇总。
 * @module dsh-tui-app/session/feedback
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** One persisted reply rating. */
export interface FeedbackRecord {
  sessionId: string
  messageId: string
  rating: 'positive' | 'negative'
  note?: string
  at: number
}

/** The sidecar lives next to the composer history under DSH_HOME. */
export function feedbackFile(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'tui-feedback.json')
}

export function readFeedback(): FeedbackRecord[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(feedbackFile(), 'utf8'))
    return Array.isArray(parsed) ? parsed as FeedbackRecord[] : []
  } catch {
    return []
  }
}

export function writeFeedback(records: FeedbackRecord[]): void {
  try {
    mkdirSync(dirname(feedbackFile()), { recursive: true })
    writeFileSync(feedbackFile(), JSON.stringify(records, null, 2) + '\n')
  } catch {
    // A read-only home must not break the surface.
  }
}

/** One session's persisted rating counts (replay summary row, T2②). */
export function feedbackSummary(sessionId: string): { positive: number; negative: number } {
  const mine = readFeedback().filter(record => record.sessionId === sessionId)
  let positive = 0
  let negative = 0
  for (const record of mine) {
    if (record.rating === 'positive') positive++
    else negative++
  }
  return { positive, negative }
}
