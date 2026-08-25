/**
 * E1/F4 SplitDiffText：auto/宽屏与 split 布局的双栏块配对，unified 回退，
 * 以及 layout 模块态的切换语义。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { diffLayout, setDiffLayout, SplitDiffText } from '../src/view/pi-vendor/split-diff.ts'

function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
}

const diffText = [
  '-1 old line',
  '-2 old second',
  '+1 new line',
  '+2 new second',
  '+3 extra new',
].join('\n')

afterEach(() => setDiffLayout('auto'))

describe('split diff (E1/F4)', () => {
  it('auto layout stays unified on narrow terminals and splits at 110 columns', () => {
    setDiffLayout('auto')
    const view = new SplitDiffText(diffText)
    expect(stripAnsi(view.render(100).join('\n'))).toContain('-1 old line')
    const wide = stripAnsi(view.render(120).join('\n'))
    expect(wide).toContain('│')
    expect(wide).toContain('old line')
    // 左旧右新：同一行上既有 old 又有 new？
    expect(wide.split('\n').some(line => line.includes('old line') && line.includes('new line'))).toBe(true)
  })

  it('split forces the two-column layout on any width; unified always single column', () => {
    setDiffLayout('split')
    const split = new SplitDiffText(diffText)
    expect(stripAnsi(split.render(80).join('\n'))).toContain('│')
    setDiffLayout('unified')
    const unified = new SplitDiffText(diffText)
    const narrow = stripAnsi(unified.render(120).join('\n'))
    expect(narrow).not.toContain('│')
    expect(narrow).toContain('-1 old line')
    expect(narrow).toContain('+1 new line')
  })

  it('unpaired additions render on the right column with an empty left', () => {
    setDiffLayout('split')
    const view = new SplitDiffText(['+1 only added'].join('\n'))
    const line = stripAnsi(view.render(120).join('\n'))
    expect(line).toContain('│')
    expect(line.trimStart()).toContain('only added')
  })
})
