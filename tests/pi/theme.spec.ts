/**
 * The vendored pi palette and highlight pipeline: color resolution, ANSI
 * wrapping, and hljs-based code styling that preserves content.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { applyPalette, bg, fg, resolveHex } from '../../src/app/pi/color.ts'
import { resolveThemeVariant, themeFromOsc11 } from '../../src/app/pi/theme-detect.ts'
import { resolveLanguage, setStrings, strings } from '../../src/view/strings.ts'
import { highlight, supportsLanguage } from '../../src/app/pi/highlight.ts'
import { getMarkdownTheme } from '../../src/app/pi/theme.ts'

afterEach(() => { applyPalette('dark') })

describe('language (T9 i18n)', () => {
  it('resolves and switches between the zh/en dictionaries', () => {
    expect(resolveLanguage(undefined)).toBe('zh')
    expect(resolveLanguage('en')).toBe('en')
    setStrings('zh')
    expect(strings().running).toBe('运行中…')
    expect(strings().durationSeconds(9)).toBe('9秒')
    expect(strings().durationMinutes(2, '05')).toBe('2分05秒')
    setStrings('en')
    expect(strings().running).toBe('Working…')
    expect(strings().diving).toBe('Deep diving...')
    expect(strings().durationSeconds(9)).toBe('9s')
    expect(strings().durationMinutes(2, '05')).toBe('2m 05s')
    expect(strings().stop).toBe('Stop generating')
    expect(strings().effort).toBe('Effort')
    expect(strings().fullAccessConfirmTitle).toBe('Enable Full access?')
    setStrings('zh')
  })
})

describe('theme detection (T5③)', () => {
  it('parses an OSC 11 reply into a variant by luminance', () => {
    expect(themeFromOsc11('\x1b]11;rgb:ffff/ffff/ffff\x1b\\')).toBe('light')
    expect(themeFromOsc11('\x1b]11;rgb:0000/0000/0000\x07')).toBe('dark')
    expect(themeFromOsc11('\x1b]11;rgb:1a1a/2b2b/3c3c\x07')).toBe('dark')
    expect(themeFromOsc11('noise')).toBeUndefined()
  })

  it('resolves the variant: env wins, auto probes, default dark', () => {
    expect(resolveThemeVariant('light', () => 'dark')).toBe('light')
    expect(resolveThemeVariant('auto', () => 'light')).toBe('light')
    expect(resolveThemeVariant('auto', () => undefined)).toBe('dark')
    // Without an explicit env value the probe never runs (terminal safety).
    expect(resolveThemeVariant(undefined, () => 'light')).toBe('dark')
  })
})

describe('pi palette (dsh web design tokens)', () => {
  it('swaps to the light palette and re-resolves colors', () => {
    applyPalette('light')
    expect(resolveHex('text')).toBe('#0F1115') // neutral-bluish-1000
    expect(resolveHex('accent')).toBe('#4176E6') // deepseek-500
    expect(fg('text')('hi')).toContain('\x1b[38;2;15;17;21m')
    applyPalette('dark')
    expect(resolveHex('text')).toBe('#F9FAFB') // neutral-bluish-50
  })


  it('resolves semantic names and literal hexes to hex strings', () => {
    expect(resolveHex('accent')).toBe('#4176E6') // deepseek-500
    expect(resolveHex('info')).toBe('#679EFE') // deepseek-400
    expect(resolveHex('userMessageBg')).toBe('#2C2C2E') // neutral-bluish-850
    expect(resolveHex('customMessageLabel')).toBe('#B197FC') // shiki function
    expect(resolveHex('nope')).toBeUndefined()
  })

  it('wraps text in SGR color sequences', () => {
    const styled = fg('accent')('hi')
    expect(styled).toContain('\x1b[38;2;65;118;230m')
    expect(styled).toContain('hi')
    expect(styled).toContain('\x1b[39m')
    const background = bg('toolErrorBg')('x')
    expect(background).toContain('\x1b[48;2;87;12;12m') // red-900
  })
})

describe('syntax highlighting', () => {
  it('recognizes common languages', () => {
    expect(supportsLanguage('typescript')).toBe(true)
    expect(supportsLanguage('bash')).toBe(true)
    expect(supportsLanguage('json')).toBe(true)
  })

  it('resolves the pi/web-style aliases of the registered subset', () => {
    expect(supportsLanguage('shell')).toBe(true) // alias → bash
    expect(supportsLanguage('ts')).toBe(true) // alias → typescript
    expect(supportsLanguage('yml')).toBe(true) // alias → yaml
    expect(supportsLanguage('html')).toBe(true) // xml 模块自带别名
  })

  it('falls back to auto detection instead of throwing on fences outside the subset', () => {
    const code = 'const x: number = 1'
    const highlighted = highlight(code, {
      language: 'zig', // 未注册语法：core 子集下 hljs.highlight 会抛错，必须兜底
      ignoreIllegals: true,
      theme: { keyword: fg('syntaxKeyword'), default: (text: string) => text },
    })
    const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '')
    expect(stripAnsi(highlighted)).toBe(code) // 内容完整保留（auto 探测为 ts 并着色）
  })

  it('styles code without losing its content', () => {
    const code = 'const answer = 42 // the answer'
    const highlighted = highlight(code, {
      language: 'javascript',
      ignoreIllegals: true,
      theme: { keyword: fg('syntaxKeyword'), comment: fg('syntaxComment'), default: (text: string) => text },
    })
    expect(highlighted).toContain('const')
    expect(highlighted).toContain('answer')
    expect(highlighted).toContain('42')
    // The comment scope picks up the palette color.
    expect(highlighted).toContain('\x1b[')
  })

  it('produces styled lines for the markdown code-block hook', () => {
    const theme = getMarkdownTheme()
    const lines = theme.highlightCode?.('let x = 1\nconsole.log(x)', 'javascript') ?? []
    expect(lines).toHaveLength(2)
    const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*m/g, '')
    expect(stripAnsi(lines.join('\n'))).toContain('console.log')
    expect(lines.join('')).toContain('\x1b[')
  })
})
