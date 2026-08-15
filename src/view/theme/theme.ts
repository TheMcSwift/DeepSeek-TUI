/**
 * The theme shim for the vendored pi interactive components. The components
 * import { theme, getMarkdownTheme } (and the Theme type) from their sibling
 * `../theme/theme.ts`; this module provides exactly those names on top of our
 * palette, so the vendored files need no edits on this axis.
 * @module dsh-tui-app/view/theme
 */

import type { EditorTheme, MarkdownTheme, SelectListTheme } from '@earendil-works/pi-tui'
import { bg, bold, fg, inverse, italic, strikethrough, underline } from '../../app/pi/color.ts'
import { getEditorTheme as editorTheme, getMarkdownTheme as markdownTheme, getSelectListTheme as selectListTheme } from '../../app/pi/theme.ts'

/** The Theme surface the vendored components call into (pi's two-arg style). */
export interface Theme {
  fg(name: string, text: string): string
  bg(name: string, text: string): string
  bold(text: string): string
  italic(text: string): string
  inverse(text: string): string
  underline(text: string): string
}

export const theme: Theme = {
  fg: (name, text) => fg(name)(text),
  bg: (name, text) => bg(name)(text),
  bold,
  italic,
  inverse,
  underline,
}

export function getMarkdownTheme(): MarkdownTheme {
  return markdownTheme()
}

export function getSelectListTheme(): SelectListTheme {
  return selectListTheme()
}

export function getEditorTheme(): EditorTheme {
  return editorTheme()
}

/** No-op compatibility shims (pi's own theme lifecycle is settings-driven). */
export function initTheme(_name?: string, _force?: boolean): void {}
export function setThemeInstance(_instance?: Theme): void {}

export { strikethrough }
