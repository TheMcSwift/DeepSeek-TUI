/**
 * The session-aggregate stats strip ported from the web's StatsLine.tsx:
 * fold math, compact token/duration formatting, cache-hit share, and the
 * exact group-composition semantics (a group with no data drops out whole).
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  billedInputTokens,
  cacheHitPercent,
  formatDuration,
  formatTokens,
  gaugeGlyph,
  liveGauge,
  sessionStats,
  sparkline,
  statsStrip,
} from '../src/projection/stats.ts'
import { setStrings, strings } from '../src/view/strings.ts'
import type { ViewDocument, ViewEntry } from '../src/document/document.ts'
import type { DecodeSample } from '../src/document/document.ts'

afterEach(() => { setStrings('zh') })

const assistant = (id: string, turn: number, step: number, over: object = {}): ViewEntry =>
  ({
    kind: 'assistant', id, turn, step, text: 'x', thinking: [], state: 'committed',
    ...over,
  })

function doc(entries: ViewEntry[]): ViewDocument {
  return { entries, busy: false }
}

describe('web StatsLine parity (session stats strip)', () => {
  it('formats compact tokens like the web', () => {
    expect(formatTokens(517)).toBe('517')
    expect(formatTokens(12_345)).toBe('12.3K')
    expect(formatTokens(517_000)).toBe('517K')
    expect(formatTokens(1_234_567)).toBe('1.2M')
    expect(formatTokens(677_000_000)).toBe('677M')
  })

  it('formats compact durations like the web', () => {
    expect(formatDuration(900)).toBe('0.9s')
    expect(formatDuration(45_200)).toBe('45.2s')
    expect(formatDuration(162_000)).toBe('2m42s')
    expect(formatDuration(20_460_000)).toBe('341m0s')
  })

  it('folds an empty document to zero stats and no strip', () => {
    const stats = sessionStats(doc([]))
    expect(stats).toMatchObject({ turns: 0, steps: 0, llmMs: 0, toolMs: 0 })
    expect(statsStrip(doc([]), strings())).toBeUndefined()
  })

  it('sums turns/steps/timings/tokens across the document', () => {
    const stats = sessionStats(doc([
      assistant('1:1', 1, 1, {
        stats: { runMs: 162_000, ttftMs: 2_900 },
        usage: { inputTokens: 100, outputTokens: 100, cacheReadTokens: 100 },
      }),
      assistant('1:2', 2, 1, {
        stats: { runMs: 100_000, ttftMs: 0 },
        usage: { inputTokens: 50, outputTokens: 25 },
      }),
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'bash', arguments: '{}', state: 'done', durationMs: 1_000, turn: 2, step: 1 },
    ]))
    expect(stats).toMatchObject({
      turns: 2, steps: 2, llmMs: 262_000, toolMs: 1_000,
      ttftMs: 2_900, ttftSteps: 1,
      decodeMs: 162_000 - 2_900, decodeTokens: 100,
      inputTokens: 150, cacheReadTokens: 100, cacheWriteTokens: 0, outputTokens: 125,
    })
    expect(billedInputTokens(stats)).toBe(250)
    expect(cacheHitPercent(stats)).toBe(40)
  })

  it('composes the strip with the exact web grouping', () => {
    const strip = statsStrip(doc([
      assistant('1:1', 1, 1, {
        stats: { runMs: 162_000, ttftMs: 2_900 },
        usage: { inputTokens: 100, outputTokens: 100, cacheReadTokens: 100 },
      }),
      assistant('1:2', 1, 2),
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'bash', arguments: '{}', state: 'done', durationMs: 1_000, turn: 1, step: 1 },
    ]), strings())
    // counts | durations | speeds | cache + tokens
    expect(strip).toBe('1 轮 · 2 步 | LLM 2m42s · 工具调用 1s | 首 token 平均 2.9s · 0.6 tok/s | 缓存命中 50% | 输入 200 tok · 输出 100 tok')
  })

  it('drops groups with no data and localizes the strip', () => {
    // Steps exist but nothing else: counts group alone.
    expect(statsStrip(doc([assistant('1:1', 1, 1)]), strings())).toBe('1 轮 · 1 步')
    setStrings('en')
    const strip = statsStrip(doc([
      assistant('1:1', 1, 1, {
        stats: { runMs: 162_000, ttftMs: 2_900 },
        usage: { inputTokens: 100, outputTokens: 100, cacheReadTokens: 100 },
      }),
      { kind: 'tool', id: 'c1', callId: 'c1', name: 'bash', arguments: '{}', state: 'done', durationMs: 1_000, turn: 1, step: 1 },
    ]), strings())
    expect(strip).toBe('1 turns · 1 steps | LLM 2m42s · Tool call 1s | TTFT avg 2.9s · 0.6 tok/s | Cache hit 50% | Input 200 tok · Output 100 tok')
  })

  it('reports a 0% cache hit when input was billed without cache reads', () => {
    const stats = sessionStats(doc([
      assistant('1:1', 1, 1, { usage: { inputTokens: 10, outputTokens: 5 } }),
    ]))
    expect(billedInputTokens(stats)).toBe(10)
    expect(cacheHitPercent(stats)).toBe(0)
  })

  describe('C1 decode gauge/sparkline', () => {
    const samples = (pairs: Array<[number, number]>): DecodeSample[] =>
      pairs.map(([t, chars]) => ({ t, chars }))

    it('omits the live gauge while the window is too short or unstable', () => {
      expect(liveGauge(undefined)).toBeUndefined()
      expect(liveGauge(samples([[0, 10]]))).toBeUndefined()
      // span under 250ms: too jittery to show.
      expect(liveGauge(samples([[0, 10], [100, 12]]))).toBeUndefined()
    })

    it('estimates tps from the recent window and clamps the bars', () => {
      // 8 samples at 200ms spacing, 10 chars each: span 1400ms,
      // 80 chars ≈ 20 tokens → 14.3 tok/s → bars ceil(14.3/50*8)=3.
      const window = Array.from({ length: 8 }, (_, i) => [1000 + i * 200, 10] as [number, number])
      const gauge = liveGauge(samples(window))
      expect(gauge).toBeDefined()
      expect(gauge!.tps).toBe(14.3)
      expect(gauge!.bars).toBe(3)
      // A very fast window clamps to the full bar count.
      const fast = Array.from({ length: 8 }, (_, i) => [2000 + i * 200, 500] as [number, number])
      expect(liveGauge(samples(fast))!.bars).toBe(8)
    })

    it('renders the gauge glyphs with fixed slot count', () => {
      expect(gaugeGlyph(3)).toBe('▰▰▰▱▱▱▱▱')
      expect(gaugeGlyph(0)).toBe('▱▱▱▱▱▱▱▱')
      expect(gaugeGlyph(9)).toBe('▰▰▰▰▰▰▰▰')
    })

    it('sparkline: min-max normalizes the last 12 samples and stays flat-silent', () => {
      const flat = samples(Array.from({ length: 6 }, (_, i) => [i * 100, 8]))
      expect(sparkline(flat)).toBeUndefined()
      expect(sparkline(undefined)).toBeUndefined()
      expect(sparkline(samples([[0, 1]]))).toBeUndefined()
      const shaped = samples([[0, 1], [100, 2], [200, 4]])
      // min-max over 7 steps: (1-1)/3*7=0 → ▁; (2-1)/3*7≈2.3 → ▃; (4-1)/3*7=7 → █.
      expect(sparkline(shaped)).toBe('▁▃█')
    })
  })
})
