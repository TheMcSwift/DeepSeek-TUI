/**
 * 视觉主题四预设的完整性回归：每个预设 × 明暗两版都必须覆盖 web 预设的
 * 全部语义色名（resolveHex 能解析），并对三个外部风格预设做真值抽查
 * （pi 官方 dark/light.json、opencode 默认 opencode.json 的逐字取值）。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { applyPalette, resolveHex } from '../../src/app/pi/color.ts'
import { THEME_PRESETS, isThemePresetId, themePresetById } from '../../src/app/pi/theme-presets.ts'

afterEach(() => { applyPalette('web', 'dark') })

/** web 预设声明的全部语义色名（键覆盖基准）。 */
function allWebColorNames(): string[] {
  const base = THEME_PRESETS[0].dark.colors
  const extra = THEME_PRESETS[0].light.colors
  return [...new Set([...Object.keys(base), ...Object.keys(extra)])]
}

describe('theme presets', () => {
  it('covers every web semantic color in every preset and variant', () => {
    const names = allWebColorNames()
    for (const preset of THEME_PRESETS) {
      for (const variant of ['dark', 'light'] as const) {
        applyPalette(preset.id, variant)
        for (const name of names) {
          const hex = resolveHex(name)
          expect(hex, `${preset.id}/${variant} 缺少 ${name}`).toBeDefined()
          if (hex !== undefined) expect(hex, `${preset.id}/${variant} ${name}`).toMatch(/^#[0-9A-Fa-f]{6}$/)
        }
      }
    }
  })

  it('ships the authentic pi palette values (dark/light.json verbatim)', () => {
    const pi = themePresetById('pi')
    expect(pi.dark.vars.accent).toBe('#8abeb7')
    expect(pi.dark.vars.blue).toBe('#5f87ff')
    expect(pi.dark.vars.text).toBe('#d4d4d4')
    expect(pi.dark.colors.syntaxKeyword).toBe('#569CD6')
    expect(pi.light.vars.accent).toBe('#5a8080')
    expect(pi.light.colors.syntaxKeyword).toBe('#0000FF')
  })

  it('ships the authentic opencode default palette values (opencode.json verbatim)', () => {
    const oc = themePresetById('opencode')
    expect(oc.dark.vars.text).toBe('#eeeeee')
    expect(oc.dark.vars.accent).toBe('#9d7cd8')
    expect(oc.dark.vars.red).toBe('#e06c75')
    expect(oc.dark.colors.toolDiffAdded).toBe('#4fd6be')
    expect(oc.dark.colors.mdLink).toBe('#fab283')
    expect(oc.light.vars.accent).toBe('#d68c27')
    applyPalette('opencode', 'light')
    expect(resolveHex('mdLink')).toBe('#3b7dd8') // 语义值经变量 'blue' 解析
  })

  it('gives the cc preset its Claude Code identity (terracotta accent, quiet borders)', () => {
    const cc = themePresetById('cc')
    expect(cc.dark.vars.accent).toBe('#D97757')
    expect(cc.dark.colors.border).toBe('#30333A')
    expect(cc.light.vars.accent).toBe('#BF5B32')
  })

  it('validates and looks up preset ids', () => {
    expect(isThemePresetId('web')).toBe(true)
    expect(isThemePresetId('cc')).toBe(true)
    expect(isThemePresetId('pi')).toBe(true)
    expect(isThemePresetId('opencode')).toBe(true)
    expect(isThemePresetId('tokyonight')).toBe(false)
    expect(themePresetById('opencode').id).toBe('opencode')
    expect(themePresetById('nope' as never).id).toBe('web') // 兜底
  })
})
