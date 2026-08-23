/**
 * chalk-backed color functions over the vendored pi palette: `fg(name)` /
 * `bg(name)` resolve a semantic role to its hex color (or literal hex) and
 * return cached SGR formatters. Mirrors pi's theme.ts color plumbing
 * (earendil-works/pi, MIT), minus the settings/typebox machinery.
 * @module dsh-tui-app/app/pi/color
 */

import chalk from 'chalk'
import { customColor, PALETTE_COLORS, PALETTE_VARS, applyPaletteSet } from './palette.ts'
import { themePresetById } from './theme-presets.ts'
import type { ThemePresetId } from './theme-presets.ts'

// The surface only runs on a real terminal; force truecolor so tests and
// pipes render the same palette (chalk's TTY detection would strip colors).
chalk.level = 3

let fgCache = new Map<string, (text: string) => string>()
let bgCache = new Map<string, (text: string) => string>()

/** Drop baked formatters after a palette swap (preset/variant). */
function resetColorCaches(): void {
  fgCache = new Map()
  bgCache = new Map()
}

/**
 * Swap the palette and drop baked color formatters; call before building
 * views（或换肤时先换、再让视图层重建）。variant 沿用 DSH_TUI_THEME 的
 * light/dark（/theme 只切预设，不动明暗）。
 */
export function applyPalette(preset: ThemePresetId, variant: 'dark' | 'light'): void {
  const target = themePresetById(preset)
  applyPaletteSet(variant === 'light' ? target.light : target.dark)
  resetColorCaches()
}

/** Resolve a semantic color name to a hex string. */
export function resolveHex(name: string): string | undefined {
  // F1: 自定义主题覆盖层优先（applyCustomThemeColors 的已知角色校验在前）。
  const custom = customColor(name)
  if (custom !== undefined) return custom
  const value = PALETTE_COLORS[name]
  if (value === undefined) return undefined
  if (value.startsWith('#')) return value
  return PALETTE_VARS[value] ?? PALETTE_COLORS[value]
}

/** Foreground formatter for a semantic color name. */
export function fg(name: string): (text: string) => string {
  let formatter = fgCache.get(name)
  if (formatter === undefined) {
    const style = chalk.hex(resolveHex(name) ?? '#d4d4d4')
    formatter = (text: string): string => style(text)
    fgCache.set(name, formatter)
  }
  return formatter
}

/** Background formatter for a semantic color name. */
export function bg(name: string): (text: string) => string {
  let formatter = bgCache.get(name)
  if (formatter === undefined) {
    const style = chalk.bgHex(resolveHex(name) ?? '#000000')
    formatter = (text: string): string => style(text)
    bgCache.set(name, formatter)
  }
  return formatter
}

export const bold = (text: string): string => chalk.bold(text)
export const underline = (text: string): string => chalk.underline(text)
export const inverse = (text: string): string => chalk.inverse(text)
export const italic = (text: string): string => chalk.italic(text)
export const strikethrough = (text: string): string => chalk.strikethrough(text)
