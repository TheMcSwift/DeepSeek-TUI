/**
 * 快捷键双预设的解析回归：cc 与 pi 两张键位图在 busy/idle 两态下的动作
 * 分发，以及 Tab/Esc 焦点环不进预设的约定由 pi-tui-app.spec 覆盖。
 */

import { describe, expect, it } from 'vitest'
import { CC_KEYMAP, PI_KEYMAP, isKeymapId, keymapById, resolveKeyAction } from '../../src/app/pi/keymaps.ts'

describe('keymap presets', () => {
  it('resolves the cc preset: Esc interrupts, idle Ctrl+C quits, busy Ctrl+C is swallowed', () => {
    expect(resolveKeyAction(CC_KEYMAP, '\x1b', true)).toBe('interrupt')
    expect(resolveKeyAction(CC_KEYMAP, '\x03', false)).toBe('quit')
    expect(resolveKeyAction(CC_KEYMAP, '\x03', true)).toBe('swallow')
    expect(resolveKeyAction(CC_KEYMAP, '\x07', false)).toBe('model') // Ctrl+G → 模型
    expect(resolveKeyAction(CC_KEYMAP, '\x10', false)).toBe('permission') // Ctrl+P → 权限
  })

  it('resolves the pi preset: Ctrl+C interrupts/quit, Ctrl+G composes, Ctrl+P picks the model', () => {
    expect(resolveKeyAction(PI_KEYMAP, '\x03', true)).toBe('interrupt')
    expect(resolveKeyAction(PI_KEYMAP, '\x03', false)).toBe('quit')
    expect(resolveKeyAction(PI_KEYMAP, '\x1b', true)).toBe('interrupt') // Esc 保留为次中断键
    expect(resolveKeyAction(PI_KEYMAP, '\x07', false)).toBe('compose') // Ctrl+G → 编辑器撰写
    expect(resolveKeyAction(PI_KEYMAP, '\x10', false)).toBe('model') // Ctrl+P → 模型
    expect(resolveKeyAction(PI_KEYMAP, '\x10', false)).not.toBe('permission')
  })

  it('returns undefined for unbound keys in both presets', () => {
    expect(resolveKeyAction(CC_KEYMAP, '\x01', false)).toBeUndefined() // Ctrl+A
    expect(resolveKeyAction(PI_KEYMAP, '\x15', false)).toBeUndefined() // Ctrl+U
  })

  it('validates and looks up ids', () => {
    expect(isKeymapId('cc')).toBe(true)
    expect(isKeymapId('pi')).toBe(true)
    expect(isKeymapId('vim')).toBe(false)
    expect(keymapById('pi').id).toBe('pi')
    expect(keymapById('cc').entries.some(entry => entry.action === 'swallow')).toBe(true)
  })
})
