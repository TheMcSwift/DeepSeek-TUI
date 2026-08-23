/**
 * The session-aggregate stats strip, ported from the dsh web client's
 * StatsLine.tsx (packages/client/ui-conversation): the same window-scoped
 * fold the web falls back to (turn/step counts, summed LLM and tool wall
 * time, averaged TTFT, decode throughput, cache-hit share and compact
 * K/M token totals) with the same "a group with no data drops out whole"
 * semantics. Pure functions over the ViewDocument — no plugins needed.
 * @module dsh-tui-app/projection/stats
 */

import type { ViewDocument } from '../document/document.ts'
import type { DecodeSample } from '../document/document.ts'
import type { Strings } from '../view/strings.ts'

export interface SessionStats {
  turns: number
  steps: number
  /** Summed step wall time (turn/start → assistant/message). */
  llmMs: number
  /** Summed tool wall time (tool/call → tool/result). */
  toolMs: number
  /** Summed first-token latency over steps that record one. */
  ttftMs: number
  ttftSteps: number
  /** Summed decode wall time over steps that also report output tokens. */
  decodeMs: number
  /** Summed output tokens over the decode-timed steps. */
  decodeTokens: number
  inputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  outputTokens: number
}

const ZERO: SessionStats = {
  turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0, ttftSteps: 0,
  decodeMs: 0, decodeTokens: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
}

/**
 * Fold the document into the web's display totals: assistant entries give
 * turns/steps/timing, tool entries give call wall time, usage gives billing.
 */
export function sessionStats(doc: ViewDocument): SessionStats {
  const stats: SessionStats = { ...ZERO }
  const turns = new Set<number>()
  for (const entry of doc.entries) {
    if (entry.kind === 'tool') {
      if (entry.durationMs !== undefined) stats.toolMs += Math.max(0, entry.durationMs)
      continue
    }
    if (entry.kind !== 'assistant') continue
    turns.add(entry.turn)
    stats.steps += 1
    if (entry.stats !== undefined) stats.llmMs += Math.max(0, entry.stats.runMs)
    const ttftMs = entry.stats?.ttftMs ?? 0
    const outputTokens = entry.usage?.outputTokens ?? 0
    if (ttftMs > 0) {
      stats.ttftMs += ttftMs
      stats.ttftSteps += 1
      if (outputTokens > 0 && entry.stats !== undefined) {
        stats.decodeMs += Math.max(0, entry.stats.runMs - ttftMs)
        stats.decodeTokens += outputTokens
      }
    }
    if (entry.usage !== undefined) {
      stats.inputTokens += entry.usage.inputTokens
      stats.cacheReadTokens += entry.usage.cacheReadTokens ?? 0
      stats.cacheWriteTokens += entry.usage.cacheWriteTokens ?? 0
      stats.outputTokens += entry.usage.outputTokens
    }
  }
  stats.turns = turns.size
  return stats
}

/** Compact token count: 517 / 12.2K / 517K / 1.2M (web StatsLine.formatTokens). */
export function formatTokens(n: number): string {
  const scaled = (v: number): string => v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10)
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`
  return `${scaled(n / 1_000_000)}M`
}

/** Compact duration: 45.2s under a minute, 2m42s from there on (web formatDuration). */
export function formatDuration(ms: number): string {
  const s = ms / 1_000
  if (s < 60) return `${Math.round(s * 10) / 10}s`
  const whole = Math.round(s)
  return `${Math.floor(whole / 60)}m${whole % 60}s`
}

/** Decode throughput: 1 decimal under 10 tok/s, integer from there (web). */
export function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps)
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
}

/** Billed prompt-side input: the three disjoint buckets the web sums. */
export function billedInputTokens(stats: SessionStats): number {
  return stats.inputTokens + stats.cacheReadTokens + stats.cacheWriteTokens
}

/** Cache-hit share of billed input, or null when nothing was billed (web). */
export function cacheHitPercent(stats: SessionStats): number | null {
  const denominator = billedInputTokens(stats)
  return denominator === 0 ? null : Math.round(stats.cacheReadTokens / denominator * 100)
}

/** C3: 上下文压力百分比（usage 求和近似，0–99；无窗口返回 undefined）。 */
export function contextPercent(doc: ViewDocument, contextWindow: number | undefined): number | undefined {
  if (contextWindow === undefined || contextWindow <= 0) return undefined
  let used = 0
  for (const entry of doc.entries) {
    if (entry.kind !== 'assistant') continue
    used += entry.usage?.inputTokens ?? 0
    used += entry.usage?.outputTokens ?? 0
  }
  return Math.min(99, Math.round((used / contextWindow) * 100))
}

// C1: streaming decode throughput helpers (pure, display-only estimates).
// Tokens are approximated at ~4 chars/token; the gauge is qualitative and the
// sparkline normalizes relative shapes, so the constant only sets magnitude.

/** Approximate chars per token (display approximation for C1 gauges). */
export const CHARS_PER_TOKEN = 4

/** Sparkline glyph spectrum, lowest bar at index 0. */
const SPARK_BARS = '▁▂▃▄▅▆▇█'

/**
 * Live streaming gauge (C1): the recent sample window's char throughput
 * mapped onto `slots` filled cells (`▰` filled / `▱` empty) plus the
 * estimated tok/s. Returns undefined when the window is too small/short to
 * be stable (the caller then omits the gauge rather than flashing it).
 */
export function liveGauge(
  samples: DecodeSample[] | undefined,
  slots = 8,
): { bars: number; tps: number } | undefined {
  if (samples === undefined || samples.length < 2) return undefined
  const window = samples.slice(-8)
  const spanMs = window[window.length - 1].t - window[0].t
  if (spanMs < 250) return undefined
  const chars = window.reduce((sum, s) => sum + s.chars, 0)
  const tps = Math.round(chars / CHARS_PER_TOKEN / (spanMs / 1000) * 10) / 10
  const bars = Math.max(1, Math.min(slots, Math.ceil(tps / 50 * slots)))
  return { bars, tps }
}

/** Render the live gauge glyphs (`▰▰▱▱▱▱▱▱`, `slots` cells). */
export function gaugeGlyph(bars: number, slots = 8): string {
  const filled = Math.max(0, Math.min(slots, bars))
  return '▰'.repeat(filled) + '▱'.repeat(slots - filled)
}

/**
 * Post-turn decode sparkline (C1): the last 12 samples' char counts
 * min-max normalized onto `slots` glyph steps. Returns undefined when the
 * data is too flat to draw (all samples equal) or too sparse.
 */
export function sparkline(
  samples: DecodeSample[] | undefined,
  slots = 8,
): string | undefined {
  const recent = (samples ?? []).slice(-12)
  if (recent.length < 2) return undefined
  let min = Infinity
  let max = -Infinity
  for (const s of recent) {
    if (s.chars < min) min = s.chars
    if (s.chars > max) max = s.chars
  }
  if (max <= min) return undefined
  return recent
    .map(s => SPARK_BARS[Math.round((s.chars - min) / (max - min) * (slots - 1))])
    .join('')
}

/**
 * Compose the strip with the web's grouping: counts | durations | speeds |
 * cache/tokens, joined with ` | `; a group with no data drops out whole,
 * and an empty session (zero steps) returns undefined (blank slot).
 */
export function statsStrip(doc: ViewDocument, s: Strings): string | undefined {
  const stats = sessionStats(doc)
  const groups: string[] = []
  if (stats.steps > 0) {
    groups.push(s.statsCounts(stats.turns, stats.steps))
    const durations: string[] = []
    if (stats.llmMs > 0) durations.push(s.statsLlm(formatDuration(stats.llmMs)))
    if (stats.toolMs > 0) durations.push(s.statsToolCall(formatDuration(stats.toolMs)))
    if (durations.length > 0) groups.push(durations.join(' · '))
    const speeds: string[] = []
    if (stats.ttftSteps > 0) speeds.push(s.statsTtftAverage(formatDuration(stats.ttftMs / stats.ttftSteps)))
    if (stats.decodeMs > 0) speeds.push(s.statsTokensPerSecond(formatTokensPerSecond(stats.decodeTokens / (stats.decodeMs / 1_000))))
    if (speeds.length > 0) groups.push(speeds.join(' · '))
  }
  if (billedInputTokens(stats) > 0 || stats.outputTokens > 0) {
    const cacheHit = cacheHitPercent(stats)
    if (cacheHit !== null) groups.push(s.statsCacheHit(cacheHit))
    groups.push(s.statsTokens(formatTokens(billedInputTokens(stats)), formatTokens(stats.outputTokens)))
  }
  return groups.length === 0 ? undefined : groups.join(' | ')
}
