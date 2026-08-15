/**
 * Terminal background auto-detection (T5③, pi theme-controller parity):
 * query the terminal's background color through OSC 11 and pick the light or
 * dark palette by luminance. The live query is best-effort (a silent terminal
 * falls back to dark); the parsing and resolution logic is pure and testable.
 * @module dsh-tui-app/app/pi/theme-detect
 */

/** Parse an OSC 11 reply (`ESC]11;rgb:RRRR/GGGG/BBBB[ESC\]|BEL`). */
export function themeFromOsc11(response: string): 'light' | 'dark' | undefined {
  const match = /rgb:([0-9a-fA-F]{4})\/([0-9a-fA-F]{4})\/([0-9a-fA-F]{4})/.exec(response)
  if (match === null) return undefined
  const channel = (hex: string): number => Number.parseInt(hex.slice(0, 2), 16) / 255
  const luminance = 0.2126 * channel(match[1]) + 0.7152 * channel(match[2]) + 0.0722 * channel(match[3])
  return luminance > 0.5 ? 'light' : 'dark'
}

/** The effective palette variant: light/dark win; `auto` runs the probe. */
export function resolveThemeVariant(
  envValue: string | undefined,
  detect: (() => 'light' | 'dark' | undefined) | undefined,
): 'dark' | 'light' {
  if (envValue === 'light' || envValue === 'dark') return envValue
  if (envValue === 'auto') return detect?.() ?? 'dark'
  return 'dark'
}

/** Best-effort live query: OSC 11 → 300ms window → fallback dark. */
export function detectThemeLive(): 'light' | 'dark' | undefined {
  if (process.stdout.isTTY !== true || process.stdin.isTTY !== true) return undefined
  try {
    process.stdout.write('\x1b]11;?\x07')
    let result: 'light' | 'dark' | undefined
    let settled = false
    let response = ''
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      process.stdin.off('data', onData)
    }
    const onData = (chunk: Buffer): void => {
      response += chunk.toString()
      const parsed = themeFromOsc11(response)
      if (parsed !== undefined) {
        result = parsed
        finish()
      }
    }
    process.stdin.on('data', onData)
    const timer = setTimeout(finish, 300)
    return result
  } catch {
    return undefined
  }
}
