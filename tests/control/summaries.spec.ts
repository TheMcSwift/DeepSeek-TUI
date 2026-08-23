/**
 * A3 `/context` report: inject rows (notice entries with the `inject:` id
 * prefix) grouped by injection kind, first-line previews, and the empty
 * state. Pure function over the document — no IO.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { contextReport, matchTraceQuery } from '../../src/control/summaries.ts'
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

describe('matchTraceQuery (A13)', () => {
  const rows = [
    { seq: 1, type: 'turn/start', summary: 'turn 1 开始' },
    { seq: 2, type: 'tool/call', summary: 'bash {"command":"echo hi"}' },
    { seq: 3, type: 'tool/result', summary: '✗ error hi' },
    { seq: 4, type: 'assistant/message', summary: 'answer · in 1200 out 800' },
    { seq: 5, type: 'turn/start', summary: 'turn 2 开始' },
  ]

  it('prefix queries AND-normalized against type/summary fields', () => {
    expect(matchTraceQuery('tool:bash', rows[1])).toBe(true)
    expect(matchTraceQuery('tool:bash', rows[0])).toBe(false)
    expect(matchTraceQuery('kind:tool', rows[2])).toBe(true)
    expect(matchTraceQuery('turn:1', rows[0])).toBe(true)
    expect(matchTraceQuery('turn:2', rows[0])).toBe(false)
    expect(matchTraceQuery('err:', rows[2])).toBe(true)
    expect(matchTraceQuery('err: ok', rows[2])).toBe(false) // AND: ok 不命中
    expect(matchTraceQuery('kind:tool err:', rows[2])).toBe(true) // 前缀 AND
    expect(matchTraceQuery('tool:bash err:', rows[2])).toBe(false) // bash 不在此行
    expect(matchTraceQuery('', rows[0])).toBe(true) // 空查询全放行
  })

  it('falls back to plain keyword matching on seq/type/summary', () => {
    expect(matchTraceQuery('answer', rows[3])).toBe(true)
    expect(matchTraceQuery('4', rows[3])).toBe(true)
    expect(matchTraceQuery('echo', rows[1])).toBe(true)
  })
})
