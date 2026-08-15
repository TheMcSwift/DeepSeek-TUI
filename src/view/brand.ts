/**
 * The DeepSeek brand splash, adapted from the dsh-TUI community project
 * (github.com/ccch1mneyyy/dsh-TUI, MIT License): the hand-drawn DeepSeek
 * pixel whale (half-block technique) beside a 5-row block-font "DEEPSEEK"
 * wordmark with a horizontal brand gradient, plus the tagline. Unlike the
 * reference (which pins it as a fixed header), the TUI renders it at the
 * top of the transcript while the session is still empty — the bottom
 * anchor keeps it right above the composer and it scrolls away naturally
 * once the conversation starts.
 *
 * The art colors are the reference's sprite palette; the wordmark gradient
 * and tagline use the dsh web design tokens (deepseek-450 #5686FE →
 * deepseek-300 #B7C8FE) so the splash matches the web theme colors.
 * @module dsh-tui-app/view/brand
 */

import type { Component } from '@earendil-works/pi-tui'
import type { ViewDocument } from '../document/document.ts'
import { strings } from './strings.ts'

/** Sprite palette: D outline · B body · L belly · W mouth · `.` transparent. */
const WHALE_COLORS: Record<string, [number, number, number] | undefined> = {
  D: [20, 38, 96],
  B: [78, 111, 255],
  L: [190, 225, 255],
  W: [255, 255, 255],
}

/** Wordmark gradient endpoints (dsh web tokens, deepseek scale). */
export const BRAND: [number, number, number] = [86, 134, 254] // deepseek-450 #5686FE
export const ICE: [number, number, number] = [183, 200, 254] // deepseek-300 #B7C8FE
/** Sweep highlight color (the reference's FLASH, stays visibly blue). */
const FLASH: [number, number, number] = [198, 216, 248]

type Rgb = [number, number, number]

/** Opening shimmer duration and frame cadence (the reference's numbers). */
export const BRAND_OPENING_MS = 3400
export const BRAND_FRAME_MS = 60
/** Sweep highlight window width, in terminal columns. */
const SWEEP_WINDOW = 8

const esc = (rgb: [number, number, number]): string => `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`
const bgEsc = (rgb: [number, number, number]): string => `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`
const RESET = '\x1b[0m'

/** The whale's settled pose (frame `standard` of the reference's sprite). */
const WHALE_SPRITE: readonly string[] = [
  '........................................',
  '........................................',
  '........................D...............',
  '.......................DBD.......D......',
  '.......................DBBD.....DBD.....',
  '.......................DBBBD..DDBBD.....',
  '.......................DBBBBDDBBBBD.....',
  '.......DDDDDDDDD........DBBBBBBBBD......',
  '......DBBBBBBBBBDD.......DBBBBBBBD......',
  '.....DBBBBBBBBBBBBDD.....DBBBBBDD.......',
  '....DBBBBBBBBBBBBBBBDD....DBBBD.........',
  '...DDBBBBBBBBBBBBBBBBBD..DBBBBD.........',
  '...DBBBBBBBBBBBBBBBBBBBDDBBBBBD.........',
  '...DBBBDBBBBBBDBBBBBBBBBBBBBBBD.........',
  '...DBBBDBBBBBBDBBBBBBBBBBBBBBD..........',
  '...DBBBBBBBBBBBBBBBBBBBBBBBBBD..........',
  '...DBBBBWWWWWWWBBBBBBBBDBBBBD...........',
  '...DDBWWWWWWWWWWWWBBBBBBDBBBD...........',
  '....DLLWWWWWWWWWWWWDBBBBDDBD............',
  '.....DLLLWWWWWWWWWWDBBBBBDD.............',
  '......DDLLLWWWWWWLLLDBBBBBDD............',
  '........DLLLLLLLLLLLDDBBBBBBD...........',
  '.........DDDDDDDDDDD..DDDDDDD...........',
  '........................................',
  '........................................',
]

/**
 * Render the sprite to ANSI rows with the half-block technique: each
 * terminal cell packs two vertical pixels into one `▀`/`▄` glyph, so the
 * whale shows at roughly 40 columns × 13 rows with square pixels.
 */
export function whaleRows(): string[] {
  const rows: string[] = []
  for (let r = 0; r < WHALE_SPRITE.length; r += 2) {
    const upper = WHALE_SPRITE[r]
    const lower = WHALE_SPRITE[r + 1] ?? ''
    let out = ''
    let current = ''
    for (let x = 0; x < upper.length; x++) {
      const up = WHALE_COLORS[upper[x]]
      const lo = WHALE_COLORS[lower[x]]
      let seq: string
      let ch: string
      if (up !== undefined && lo !== undefined) {
        seq = esc(up) + bgEsc(lo)
        ch = '▀'
      } else if (up !== undefined) {
        seq = esc(up)
        ch = '▀'
      } else if (lo !== undefined) {
        seq = esc(lo)
        ch = '▄'
      } else {
        seq = ''
        ch = ' '
      }
      if (seq !== current) {
        out += seq === '' ? RESET : seq
        current = seq
      }
      out += ch
    }
    let row = out.replace(/[ ]+$/, '')
    if (!row.endsWith(RESET)) row += RESET
    rows.push(row)
  }
  return rows
}

/** 5-row block font; `·` is a transparent cell. Only the tagline's letters exist. */
const GLYPHS: Record<string, readonly [string, string, string, string, string]> = {
  D: ['█▀▀▀▄', '█···█', '█···█', '█···█', '█▄▄▄▀'],
  E: ['█▀▀▀▀', '█····', '█▀▀▀·', '█····', '█▄▄▄▄'],
  P: ['█▀▀▀▄', '█···█', '█▄▄▄▀', '█····', '█····'],
  S: ['█▀▀▀▀', '█····', '·▀▀▀▄', '····█', '█▄▄▄▀'],
  K: ['█···█', '█·█··', '██···', '█·█··', '█···█'],
}

const FALLBACK: readonly [string, string, string, string, string] = [
  '▄▄▄▄▄',
  '█···█',
  '█···█',
  '█···█',
  '▀▀▀▀▀',
]

/** Visible character count of a styled string (ANSI sequences ignored). */
function visibleLength(text: string): number {
  return text.replace(/\x1b\[[0-9;]*[ -/]*[@-~]/g, '').length
}

function interpolate(
  from: Rgb,
  to: Rgb,
  t: number,
): Rgb {
  return [
    Math.round(from[0] + (to[0] - from[0]) * t),
    Math.round(from[1] + (to[1] - from[1]) * t),
    Math.round(from[2] + (to[2] - from[2]) * t),
  ]
}

/** The sweep window's position and brightness at time `t` (ms). */
function sweepState(t: number, width: number, stepMs: number): { start: number; pulse: number } {
  const cycle = width + SWEEP_WINDOW * 2
  const start = (Math.floor(t / stepMs) % cycle) - SWEEP_WINDOW
  const pulse = (Math.sin(t / (stepMs * 2)) + 1) / 2
  return { start, pulse }
}

/** One style change: reset between runs, so no SGR leaks into padding. */
function appendStyle(out: string, seq: string, current: string): { out: string; current: string } {
  const next = seq === current ? '' : seq
  return { out: out + next, current: next === '' ? current : seq }
}

/**
 * `text` with the web-style shimmer: a moving SWEEP_WINDOW-wide highlight
 * mixed toward `flash` travels left to right while pulsing in brightness
 * (the reference dsh-TUI's `sweep`). At t=0 the window is parked off-screen,
 * so the settled text is the plain static color.
 */
export function sweepText(text: string, t: number, base: Rgb, flash: Rgb, stepMs = BRAND_FRAME_MS): string {
  const { start, pulse } = sweepState(t, text.length, stepMs)
  let out = ''
  let current = ''
  for (let x = 0; x < text.length; x++) {
    const ch = text[x]
    if (ch === ' ') {
      if (current !== '') {
        out += RESET
        current = ''
      }
      out += ' '
      continue
    }
    let color = base
    if (x >= start && x < start + SWEEP_WINDOW) color = interpolate(color, flash, pulse)
    const { out: nextOut, current: nextCurrent } = appendStyle(out, esc(color), current)
    out = nextOut + ch
    current = nextCurrent
  }
  if (current !== '') out += RESET
  return out
}

/**
 * `text` with the web-brand gradient: each visible character interpolates
 * `from` → `to` across the line (spaces stay transparent). While the
 * opening shimmer runs (t > 0) the moving sweep window mixed toward `flash`
 * rides on top, exactly like the DEEPSEEK wordmark; at t=0 the output is
 * the plain static gradient. The row always ends with RESET.
 */
export function gradientText(
  text: string,
  from: Rgb,
  to: Rgb,
  t = 0,
  flash: Rgb = FLASH,
  stepMs = BRAND_FRAME_MS,
): string {
  const visible = text.split('').filter(ch => ch !== ' ')
  const width = visible.length
  const { start, pulse } = sweepState(t, width, stepMs)
  let out = ''
  let current = ''
  let x = 0
  for (const ch of text) {
    if (ch === ' ') {
      if (current !== '') {
        out += RESET
        current = ''
      }
      out += ' '
      continue
    }
    let color = interpolate(from, to, width <= 1 ? 0 : x / (width - 1))
    if (x >= start && x < start + SWEEP_WINDOW) color = interpolate(color, flash, pulse)
    x += 1
    const { out: nextOut, current: nextCurrent } = appendStyle(out, esc(color), current)
    out = nextOut + ch
    current = nextCurrent
  }
  if (current !== '') out += RESET
  return out
}

/**
 * `text` in the 5-row block font with a horizontal gradient from `from` →
 * `to`; while the opening shimmer runs, a moving SWEEP_WINDOW-wide window
 * mixed toward `flash` (with a brightness pulse) travels across it. At
 * t=0 the sweep parks off-screen, leaving the static gradient.
 */
export function deepSeekWordmarkRows(
  from: Rgb,
  to: Rgb,
  t = 0,
  flash: Rgb = FLASH,
  stepMs = BRAND_FRAME_MS,
): string[] {
  const ADVANCE = 6
  const WORD_GAP = 2
  const text = 'DEEPSEEK'
  const width = text.length * ADVANCE
  const { start, pulse } = sweepState(t, width, stepMs)
  const rows: string[] = []
  for (let row = 0; row < 5; row++) {
    let out = ''
    let current = ''
    let x = 0
    const emit = (ch: string): void => {
      if (ch === ' ' || ch === '·') {
        if (current !== '') {
          out += RESET
          current = ''
        }
        out += ' '
        x += 1
        return
      }
      let color = interpolate(from, to, width <= 1 ? 0 : x / (width - 1))
      if (x >= start && x < start + SWEEP_WINDOW) color = interpolate(color, flash, pulse)
      if (esc(color) !== current) {
        out += esc(color)
        current = esc(color)
      }
      out += ch
      x += 1
    }
    for (const ch of text) {
      if (ch === ' ') {
        for (let i = 0; i < WORD_GAP; i++) emit(' ')
        continue
      }
      const glyph = GLYPHS[ch] ?? FALLBACK
      for (const cell of glyph[row]) emit(cell)
      emit(' ')
    }
    if (current !== '') out += RESET
    rows.push(out)
  }
  return rows
}

const WHALE_BOX = 40
const TEXT_COLUMN = WHALE_BOX + 2

/** The tagline rows (DeepSeek slogan, bilingual like the reference's i18n). */
function taglineRows(t: number): string[] {
  return [`  ${sweepText(strings().brandTagline, t, ICE, FLASH)}`, '']
}

/**
 * Compose the brand block for the terminal width at animation time `t`
 * (ms; 0 = settled static gradient).
 * - ≥92 columns: whale beside the wordmark column (wordmark + DEEPSEEK).
 * - 64–91: the whale alone, tagline beneath.
 * - <64: text-only (wordmark + DEEPSEEK + tagline).
 */
export function brandRowsAt(width: number, t: number): string[] {
  const whale = whaleRows()
  if (width >= 92) {
    const text = [sweepText('✦ dsh tui', t, BRAND, FLASH), '', ...deepSeekWordmarkRows(BRAND, ICE, t)]
    const rows: string[] = []
    for (let i = 0; i < whale.length; i++) {
      const whaleRow = whale[i]
      const right = text[i] ?? ''
      if (right === '' && visibleLength(whaleRow) === 0) {
        rows.push('')
        continue
      }
      rows.push(whaleRow + ' '.repeat(Math.max(0, TEXT_COLUMN - visibleLength(whaleRow))) + right)
    }
    return ['', ...rows, ...taglineRows(t)]
  }
  if (width >= 64) {
    return ['', ...whale, ...taglineRows(t)]
  }
  return ['', sweepText('✦ dsh tui', t, BRAND, FLASH), '', ...deepSeekWordmarkRows(BRAND, ICE, t), ...taglineRows(t)]
}

/** The settled brand block (sweep parked, static gradient). */
export function brandRows(width: number): string[] {
  return brandRowsAt(width, 0)
}

/** A brand entry is a user/assistant-free session (the splash scrolls away). */
export function shouldShowBrand(doc: ViewDocument): boolean {
  return !doc.entries.some(entry => entry.kind === 'user' || entry.kind === 'assistant')
}

/**
 * Renders the splash with the web-style opening shimmer: while visible it
 * replays a ~3.4s opening sequence (moving sweep highlight + brightness
 * pulse, one 60ms frame per repaint), then settles to the static gradient
 * with the timer cleared — like the reference's LogoV2. Pass `onFrame` to
 * drive repaints (the app wires `tui.requestRender`); without it the view
 * renders the settled frame only (test seam).
 */
export class BrandView implements Component {
  private visible = false
  private settled = true
  private startedAt = 0
  private timer?: ReturnType<typeof setInterval>

  constructor(private readonly onFrame?: () => void) {}

  setVisible(visible: boolean): void {
    if (visible === this.visible) return
    this.visible = visible
    if (visible) {
      this.settled = this.onFrame === undefined
      this.startedAt = Date.now()
      if (this.onFrame !== undefined) {
        this.timer = setInterval(() => {
          if (Date.now() - this.startedAt >= BRAND_OPENING_MS) {
            this.stopTimer()
            this.settled = true
            this.onFrame?.()
          } else {
            this.onFrame?.()
          }
        }, BRAND_FRAME_MS)
      }
    } else {
      this.stopTimer()
    }
  }

  /** Clear the opening timer (app stop / teardown). */
  stop(): void {
    this.stopTimer()
  }

  private stopTimer(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer)
      this.timer = undefined
    }
  }

  invalidate(): void {
    // No cached state beyond the visible flag.
  }

  render(width: number): string[] {
    if (!this.visible) return []
    const t = this.settled ? 0 : Math.min(Date.now() - this.startedAt, BRAND_OPENING_MS)
    return brandRowsAt(width, t)
  }
}
