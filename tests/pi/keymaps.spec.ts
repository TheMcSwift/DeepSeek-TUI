/**
 * 快捷键双预设的解析回归：cc 与 pi 两张键位图在 busy/idle 两态下的动作
 * 分发，以及 Tab/Esc 焦点环不进预设的约定由 pi-tui-app.spec 覆盖。
 */

import { describe, expect, it } from 'vitest'
import { CC_KEYMAP, OPENCODE_KEYMAP, PI_KEYMAP, isKeymapId, isLeaderKey, keymapById, resolveKeyAction, resolveLeaderChord } from '../../src/app/pi/keymaps.ts'

describe('keymap presets', () => {
  it('resolves the cc preset: Esc/Ctrl+C interrupt while busy, idle Ctrl+C quits, Ctrl+Enter sends', () => {
    expect(resolveKeyAction(CC_KEYMAP, '\x1b', true)).toBe('interrupt')
    expect(resolveKeyAction(CC_KEYMAP, '\x03', false)).toBe('quit')
    // B2: busy Ctrl+C 也是中断（CC 语义双键中断，不再吞掉）。
    expect(resolveKeyAction(CC_KEYMAP, '\x03', true)).toBe('interrupt')
    // B5: Ctrl+Enter = 打断当前回合并立即投递输入。普通终端 Ctrl+Enter 与 Enter
    // 同字节（\r），只有扩展键盘协议（kitty CSI u）能区分——绑定按 CSI u 匹配。
    expect(resolveKeyAction(CC_KEYMAP, '\x1b[13;5u', false)).toBe('interruptSend')
    expect(resolveKeyAction(CC_KEYMAP, '\x1b[13;5u', true)).toBe('interruptSend')
    expect(resolveKeyAction(CC_KEYMAP, '\r', false)).toBeUndefined() // 裸 Enter 不进动作表
    // B8: Shift+Tab 循环会话模式。
    expect(resolveKeyAction(CC_KEYMAP, '\x1b[Z', false)).toBe('cycleMode')
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
    expect(isKeymapId('opencode')).toBe(true)
    expect(isKeymapId('vim')).toBe(false)
    expect(keymapById('pi').id).toBe('pi')
    expect(keymapById('cc').entries.some(entry => entry.action === 'interruptSend')).toBe(true)
  })

  it('ships per-preset interaction profiles (广义交互层)', () => {
    expect(keymapById('cc').interaction).toEqual({ enum: 'inline-cycle', card: 'plain', slash: 'spacious' })
    expect(keymapById('pi').interaction).toEqual({ enum: 'list', card: 'boxed', slash: 'compact' })
    expect(keymapById('opencode').interaction).toEqual({ enum: 'list', card: 'centered', slash: 'popup' })
  })

  it('resolves the opencode preset: Ctrl+P palette, Ctrl+R rename, busy Ctrl+C clears input', () => {
    expect(resolveKeyAction(OPENCODE_KEYMAP, '\x10', false)).toBe('palette')
    expect(resolveKeyAction(OPENCODE_KEYMAP, '\x12', false)).toBe('rename') // Ctrl+R
    expect(resolveKeyAction(OPENCODE_KEYMAP, '\x03', true)).toBe('clearInput') // busy Ctrl+C
    expect(resolveKeyAction(OPENCODE_KEYMAP, '\x03', false)).toBe('quit') // idle Ctrl+C
    expect(resolveKeyAction(OPENCODE_KEYMAP, '\x1b', true)).toBe('interrupt')
    // leader 和弦不进普通解析。
    expect(resolveKeyAction(OPENCODE_KEYMAP, 'l', false)).toBeUndefined()
  })

  it('resolves opencode leader chords (Ctrl+X prefix)', () => {
    expect(isLeaderKey(OPENCODE_KEYMAP, '\x18')).toBe(true) // Ctrl+X
    expect(isLeaderKey(CC_KEYMAP, '\x18')).toBe(false) // cc 无 leader
    expect(resolveLeaderChord(OPENCODE_KEYMAP, 'l', false)).toBe('sessions')
    expect(resolveLeaderChord(OPENCODE_KEYMAP, 'n', false)).toBe('newSession')
    expect(resolveLeaderChord(OPENCODE_KEYMAP, 'm', false)).toBe('model')
    expect(resolveLeaderChord(OPENCODE_KEYMAP, 'g', false)).toBe('trajectory')
    expect(resolveLeaderChord(OPENCODE_KEYMAP, 'e', false)).toBe('compose')
    expect(resolveLeaderChord(OPENCODE_KEYMAP, 't', false)).toBe('theme')
    expect(resolveLeaderChord(OPENCODE_KEYMAP, 'y', false)).toBe('copy')
    expect(resolveLeaderChord(OPENCODE_KEYMAP, 'x', false)).toBe('export')
    expect(resolveLeaderChord(OPENCODE_KEYMAP, 'h', false)).toBe('thinking')
    expect(resolveLeaderChord(OPENCODE_KEYMAP, 'c', false)).toBe('compact')
    expect(resolveLeaderChord(OPENCODE_KEYMAP, 'q', false)).toBeUndefined() // 退出走 ctrl+c/ctrl+d
  })
})
