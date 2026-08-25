/**
 * E1/F4 分屏 diff：宽屏（≥110 列且 auto）+ split 布局时，把 numbered
 * unified diff 的变更块配成「左旧右新」双栏；unified 强制单栏（原
 * renderDiff 路径）。layout 是模块级显示偏好（与 palette 同类的运行时
 * 呈现设置，由 /settings diffLayout 切换 + tui 命名空间持久化）。
 * @module dsh-tui-app/view/pi-vendor/split-diff
 */

import type { Component } from '@earendil-works/pi-tui'
import { fg } from '../../app/pi/color.ts'
import { renderDiff } from './diff.ts'

export type DiffLayout = 'auto' | 'split' | 'unified'

let activeLayout: DiffLayout = 'auto'

/** 设置 diff 布局（/settings diffLayout；持久化在 runner 侧）。 */
export function setDiffLayout(layout: DiffLayout): void {
  activeLayout = layout
}

export function diffLayout(): DiffLayout {
  return activeLayout
}

/** 双栏最小宽度（低于它 split 会被截断到不可读）。 */
const SPLIT_MIN_WIDTH = 110

/** 行前缀解析：`-N content` / `+N content`（numbered unified）。 */
function parseNumbered(line: string): { side: '-' | '+'; content: string } | undefined {
  const match = /^([-+])\s*\d*\s(.*)$/.exec(line)
  return match === null ? undefined : { side: match[1] as '-' | '+', content: match[2] }
}

function clip(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`
}

/** 块配对渲染：连续 - 块与连续 + 块并排（缺行补空），`│` 分隔。 */
function splitLines(text: string, width: number): string[] {
  const half = Math.max(10, Math.floor((width - 3) / 2))
  const rows = text.split('\n')
  const out: string[] = []
  let i = 0
  while (i < rows.length) {
    const first = parseNumbered(rows[i])
    if (first === undefined) {
      i++
      continue
    }
    let removed: string[] = []
    if (first.side === '-') {
      while (i < rows.length && parseNumbered(rows[i])?.side === '-') {
        removed.push(parseNumbered(rows[i])!.content)
        i++
      }
    }
    const added: string[] = []
    while (i < rows.length && parseNumbered(rows[i])?.side === '+') {
      added.push(parseNumbered(rows[i])!.content)
      i++
    }
    const pairs = Math.max(removed.length, added.length)
    for (let r = 0; r < pairs; r++) {
      const left = removed[r]
      const right = added[r]
      const leftCell = left === undefined
        ? ' '.repeat(half)
        : `${fg('toolDiffRemoved')(clip(left, half))}${' '.repeat(Math.max(0, half - clip(left, half).length))}`
      const rightCell = right === undefined
        ? ''
        : `${fg('toolDiffAdded')(clip(right, half))}${' '.repeat(Math.max(0, half - clip(right, half).length))}`
      out.push(`${leftCell} ${fg('borderMuted')('│')} ${rightCell}`)
    }
  }
  return out
}

/** Diff 文本组件：auto+宽屏/split → 双栏；否则单栏（renderDiff 现状）。 */
export class SplitDiffText implements Component {
  constructor(private readonly diffText: string) {}

  invalidate(): void {
    // Pure render over the diff text and current layout.
  }

  render(width: number): string[] {
    const layout = diffLayout()
    if (layout === 'split' || (layout === 'auto' && width >= SPLIT_MIN_WIDTH)) {
      return splitLines(this.diffText, width)
    }
    return renderDiff(this.diffText).split('\n')
  }
}
