/**
 * The DeepSeek brand splash (whale + DEEPSEEK wordmark + tagline),
 * adapted from github.com/ccch1mneyyy/dsh-TUI.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BRAND_OPENING_MS,
  BRAND,
  ICE,
  BrandView,
  brandRows,
  brandRowsAt,
  deepSeekWordmarkRows,
  gradientText,
  shouldShowBrand,
  sweepText,
  whaleRows,
} from '../src/view/brand.ts'
import { setStrings } from '../src/view/strings.ts'
import type { ViewDocument } from '../src/document/document.ts'

const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*[ -/]*[@-~]/g, '')

afterEach(() => { setStrings('zh') })

function emptyDoc(): ViewDocument {
  return { entries: [], busy: false }
}

describe('brand splash (dsh-TUI whale + DEEPSEEK wordmark)', () => {
  it('renders the whale as 13 half-block rows', () => {
    const rows = whaleRows()
    expect(rows).toHaveLength(13)
    expect(rows.join('')).toContain('▀')
    // Every row closes its SGR so padding never inherits the art colors.
    for (const row of rows) expect(row.endsWith('\x1b[0m')).toBe(true)
  })

  it('renders the DEEPSEEK wordmark as 5 gradient rows of 48 visible columns', () => {
    const rows = deepSeekWordmarkRows([86, 134, 254], [183, 200, 254])
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect(stripAnsi(row)).toHaveLength(48)
      expect(row).toContain('█')
      expect(row).toContain('\x1b[38;2;')
    }
  })

  it('composes the wide layout: whale beside the wordmark, tagline beneath', () => {
    const rows = brandRows(100)
    expect(rows).toHaveLength(16) // 1 blank + 13 whale rows + tagline + trailing blank
    expect(stripAnsi(rows[1])).toContain('✦ dsh tui')
    expect(stripAnsi(rows.join('\n'))).toContain('探索未至之境！')
  })

  it('drops the text column on mid widths and the whale on narrow ones', () => {
    const mid = brandRows(80).map(stripAnsi)
    expect(mid.join('\n')).not.toContain('✦ dsh tui')
    expect(mid.join('\n')).toContain('▀')
    const narrow = brandRows(40).map(stripAnsi)
    expect(narrow.join('\n')).toContain('✦ dsh tui')
    expect(narrow).toHaveLength(10) // wordmark + DEEPSEEK + tagline
  })

  it('localizes the tagline through strings()', () => {
    setStrings('en')
    expect(stripAnsi(brandRows(40).join('\n'))).toContain('Explore the uncharted!')
  })

  it('shows the splash only while no user/assistant message exists', () => {
    expect(shouldShowBrand(emptyDoc())).toBe(true)
    expect(shouldShowBrand({ entries: [{ kind: 'notice', id: 'n', text: 'x', tone: 'info' }], busy: false })).toBe(true)
    expect(shouldShowBrand({
      entries: [{ kind: 'user', id: 'u', seq: 1, text: 'hi' }],
      busy: false,
    })).toBe(false)
    expect(shouldShowBrand({
      entries: [{ kind: 'assistant', id: 'a', turn: 1, step: 1, text: 'hey', thinking: [], state: 'committed' }],
      busy: false,
    })).toBe(false)
  })

  it('BrandView renders zero rows while hidden', () => {
    const view = new BrandView()
    expect(view.render(100)).toEqual([])
    view.setVisible(true)
    expect(view.render(100).length).toBeGreaterThan(0)
    view.setVisible(false)
    expect(view.render(100)).toEqual([])
  })
})

describe('brand shimmer (web-style animated gradient)', () => {
  it('parks the sweep off-screen at t=0', () => {
    const settled = brandRows(100).join('')
    expect(settled).not.toContain('198;216;248') // FLASH never lights up
    expect(sweepText('ABC', 0, [86, 134, 254], [198, 216, 248])).not.toContain('198;216;248')
  })

  it('moves a highlight window across the text while the glyphs stay put', () => {
    const settled = brandRows(100)
    const moving = brandRowsAt(100, 800)
    // Only colors change between frames — layout is byte-stable.
    expect(stripAnsi(moving.join('\n'))).toBe(stripAnsi(settled.join('\n')))
    expect(moving.join('\n')).not.toBe(settled.join('\n'))
    // The sweep lights the tagline too (t=60 parks the window over char 0).
    expect(sweepText('探索', 60, [183, 200, 254], [198, 216, 248])).not.toBe(sweepText('探索', 0, [183, 200, 254], [198, 216, 248]))
  })

  it('BrandView replays the opening shimmer, then settles with the timer cleared', () => {
    vi.useFakeTimers()
    try {
      const onFrame = vi.fn()
      const view = new BrandView(onFrame)
      view.setVisible(true)
      expect(view.render(100).length).toBeGreaterThan(0)
      vi.advanceTimersByTime(600) // 10 frames
      expect(onFrame).toHaveBeenCalledTimes(10)
      vi.advanceTimersByTime(BRAND_OPENING_MS)
      // The sweep keeps repainting until the opening window ends, then one
      // settle frame parks the gradient and the timer is cleared.
      const frames = onFrame.mock.calls.length
      expect(frames).toBeGreaterThan(10)
      expect(view.render(100).join('')).toBe(brandRows(100).join(''))
      vi.advanceTimersByTime(10_000)
      expect(onFrame.mock.calls.length).toBe(frames)
      // Hiding stops the animation; re-showing replays the opening.
      view.setVisible(false)
      expect(view.render(100)).toEqual([])
      view.setVisible(true)
      expect(view.render(100).length).toBeGreaterThan(0)
      vi.advanceTimersByTime(60)
      expect(onFrame.mock.calls.length).toBe(frames + 1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('settles immediately when no repaint hook is wired (test seam)', () => {
    const view = new BrandView()
    view.setVisible(true)
    expect(view.render(40).join('')).toBe(brandRows(40).join(''))
  })
})

describe('gradient status text (web-brand gradient for Deep diving...)', () => {
  it('interpolates the brand gradient across visible characters', () => {
    const styled = gradientText('Deep diving...', BRAND, ICE)
    expect(styled).toContain('38;2;86;134;254') // starts at deepseek-450
    expect(styled).toContain('38;2;183;200;254') // ends at deepseek-300
    expect(styled.endsWith('\x1b[0m')).toBe(true)
    expect(stripAnsi(styled)).toBe('Deep diving...')
  })

  it('keeps spaces transparent and never loses glyphs', () => {
    expect(stripAnsi(gradientText('a b c', BRAND, ICE))).toBe('a b c')
  })

  it('shimmers colors only — the glyphs stay byte-stable', () => {
    const settled = gradientText('Deep diving...', BRAND, ICE, 0)
    const moving = gradientText('Deep diving...', BRAND, ICE, 800)
    expect(stripAnsi(moving)).toBe(stripAnsi(settled))
    expect(moving).not.toBe(settled)
  })
})
