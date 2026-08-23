/**
 * C3/A15 忙碌 spinner 帧预设（自建轻量帧表——勿 import dsh-working-activity，
 * 该包不在 profile 依赖树；纯数据 + 标识符解析，零 IO 可单测）。
 * star = CC SpinnerGlyph 星芒（对齐 · ✢ ✳ ✶ ✻ ✽ 逆向分析，V5 帧部分）；
 * moon/dots 为 moon8/圆点 的终端简化。
 * @module dsh-tui-app/app/pi/frames
 */

export type FrameId = 'star' | 'moon' | 'dots'

export interface FrameSet {
  id: FrameId
  frames: string[]
  intervalMs: number
}

export const FRAME_SETS: readonly FrameSet[] = [
  { id: 'star', frames: ['·', '✢', '✳', '✶', '✻', '✽'], intervalMs: 80 },
  { id: 'moon', frames: ['◑', '◕', '●', '◕', '◑', '◐', '○', '◐'], intervalMs: 120 },
  { id: 'dots', frames: ['●', '◐', '○', '◑'], intervalMs: 140 },
]

export function isFrameId(value: string): value is FrameId {
  return FRAME_SETS.some(set => set.id === value)
}

export function frameSetById(id: FrameId): FrameSet {
  return FRAME_SETS.find(set => set.id === id) ?? FRAME_SETS[0]
}
