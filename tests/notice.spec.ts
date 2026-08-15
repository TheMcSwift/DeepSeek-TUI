/**
 * View-layer notice convergence (P1): consecutive same-group notices render
 * as one row with a ×N count while the document stays append-only.
 */

import { describe, expect, it } from 'vitest'
import { convergeNotices } from '../src/view/components/notice-view.ts'
import type { NoticeEntry, ViewEntry } from '../src/document/document.ts'

const notice = (id: string, text: string, group?: string): NoticeEntry =>
  ({ kind: 'notice', id, text, tone: 'info', ...group === undefined ? {} : { group } })
const user = (id: string): ViewEntry => ({ kind: 'user', id, text: 'hi' })

describe('notice convergence (P1)', () => {
  it('merges consecutive same-group notices into the first id with a count', () => {
    const merged = convergeNotices([
      notice('t1', '会话标题：a', 'title'),
      notice('t2', '会话标题：b', 'title'),
      notice('t3', '会话标题：b', 'title'),
    ])
    expect(merged).toEqual([
      { kind: 'notice', id: 't1', text: '会话标题：b', tone: 'info', group: 'title', count: 3 },
    ])
  })

  it('breaks the run on other entries or group-less notices', () => {
    const merged = convergeNotices([
      notice('t1', '会话标题：a', 'title'),
      user('u1'),
      notice('t2', '会话标题：b', 'title'),
      notice('p1', '权限预设：x'),
    ])
    expect(merged.map(entry => entry.id)).toEqual(['t1', 'u1', 't2', 'p1'])
  })

  it('keeps different groups side by side', () => {
    const merged = convergeNotices([
      notice('t1', '会话标题：a', 'title'),
      notice('p1', '权限预设：x', 'preset'),
    ])
    expect(merged.map(entry => entry.id)).toEqual(['t1', 'p1'])
  })

  it('passes through non-notice entries untouched', () => {
    const entries = [user('u1'), user('u2')]
    expect(convergeNotices(entries)).toEqual(entries)
  })
})
