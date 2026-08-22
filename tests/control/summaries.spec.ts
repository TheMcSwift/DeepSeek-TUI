/**
 * A3 `/context` report: inject rows (notice entries with the `inject:` id
 * prefix) grouped by injection kind, first-line previews, and the empty
 * state. Pure function over the document — no IO.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { contextReport } from '../../src/control/summaries.ts'
import { setStrings } from '../../src/view/strings.ts'
import type { ViewDocument } from '../../src/document/document.ts'

afterEach(() => setStrings('zh'))

const docWith = (entries: ViewDocument['entries']): ViewDocument =>
  ({ entries, busy: false } as ViewDocument)

describe('contextReport (A3)', () => {
  it('returns the empty state when no inject rows exist', () => {
    const report = contextReport(docWith([]))
    expect(report.title).toBe('已加载上下文')
    expect(report.body).toBe('本次会话暂无注入上下文')
    setStrings('en')
    expect(contextReport(docWith([])).body).toBe('No injected context in this session yet')
  })

  it('groups inject rows by kind and clips previews to one line', () => {
    const longBody = '第一行内容很长，超过六十个字符的时候应该被截断并追加省略号……'.repeat(3)
    const report = contextReport(docWith([
      { kind: 'notice', id: 'inject:1', text: '注入 · skill-catalog · codex, tui +2 — 预览', tone: 'info', detail: longBody },
      { kind: 'notice', id: 'inject:2', text: '注入 · agent-instructions — 工作区指令', tone: 'info', detail: 'AGENTS.md 全家桶' },
    ]))
    expect(report.title).toBe('已加载上下文（2）')
    expect(report.body).toContain('【skill-catalog】')
    expect(report.body).toContain('【agent-instructions】')
    expect(report.body).toContain('AGENTS.md 全家桶')
    // The long first line is clipped to 60 chars.
    const line = report.body.split('\n').find(line => line.includes('第一行内容很长'))
    expect(line).toBeDefined()
    expect(line!.trim().length).toBeLessThanOrEqual(60)
  })
})
