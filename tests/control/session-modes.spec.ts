/**
 * Shift+Tab 会话模式循环（B8）的纯函数回归：默认 → 计划 → 完全访问。
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_SESSION_MODES, isSessionModeId, nextSessionMode } from '../../src/control/session-modes.ts'

describe('session modes (B8)', () => {
  it('cycles default → plan → full → default', () => {
    expect(nextSessionMode('default').id).toBe('plan')
    expect(nextSessionMode('plan').id).toBe('full')
    expect(nextSessionMode('full').id).toBe('default')
  })

  it('treats unknown ids as the position before default (wrap to default)', () => {
    expect(nextSessionMode('nope').id).toBe('default')
  })

  it('ships the default three-step ladder with atomic planes', () => {
    expect(DEFAULT_SESSION_MODES).toEqual([
      { id: 'default', plan: false, sandbox: 'workspace-write' },
      { id: 'plan', plan: true },
      { id: 'full', plan: false, sandbox: 'danger-full-access' },
    ])
  })

  it('validates ids', () => {
    expect(isSessionModeId('default')).toBe(true)
    expect(isSessionModeId('plan')).toBe(true)
    expect(isSessionModeId('full')).toBe(true)
    expect(isSessionModeId('sandbox')).toBe(false)
  })
})
