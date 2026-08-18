/**
 * The TUI palette, re-hosted on the dsh web design tokens
 * (deepseek-harness packages/client/ui-theme/src/styles/design-platform.css +
 * shiki.css): every hex below is a verbatim `--dsw-static-*` / `--shiki-*`
 * value from the web's dark (`body[data-ds-dark-theme]`) and light (`:root`)
 * sheets, so the terminal surfaces share the web's exact theme colors.
 * Structure mirrors pi's dark.json vars/colors split.
 * @module dsh-tui-app/app/pi/palette
 */

/** Light-scheme vars (web `:root` tokens). */
export const LIGHT_PALETTE_VARS: Record<string, string> = {
  cyan: '#4176E6', // deepseek-500 (state-business-primary light)
  sky: '#4868B2', // deepseek-600 (readable brand tint on white)
  blue: '#4176E6', // deepseek-500 (focus borders)
  green: '#22C55E', // green-500 (state-success-primary light)
  red: '#EC1313', // red-600 (state-error-primary light)
  yellow: '#DD8629', // amber-600 (state-warn-label light)
  violet: '#6741D9', // shiki token-function light
  text: '#0F1115', // neutral-bluish-1000 (label-primary light)
  gray: '#61666B', // neutral-bluish-700 (label-secondary light)
  dimGray: '#81858C', // neutral-bluish-600 (label-tertiary light)
  darkGray: '#E1E5EE', // neutral-bluish-200 (border-l2 light)
  accent: '#4176E6', // deepseek-500
  selectedBg: '#E4EDFD', // deepseek-100 (interactive accent selection)
  userMsgBg: '#EDF3FE', // deepseek-50 (specific-bubble light)
  toolPendingBg: '#F1F3F5', // neutral-bluish-75 (module surface)
  toolSuccessBg: '#E6FAED', // green-100 (state-success-tertiary light)
  toolErrorBg: '#FEE2E2', // red-100
  customMsgBg: '#ece8f7',
}

/** Semantic roles on the light palette (only the role values that differ). */
export const LIGHT_PALETTE_COLORS: Record<string, string> = {
  customMessageLabel: '#6741D9', // shiki token-function light
  thinkingL1: '#61666B',
  thinkingL2: '#81858C',
  thinkingL3: '#ADB2B8', // neutral-bluish-400 (caption)
  mdHeading: '#4868B2',
  mdLink: '#1971C2', // shiki token-link light
  mdCode: '#2F4C8F', // deepseek-700
  mdCodeBlock: '#0F1115',
  syntaxComment: '#868E96', // shiki token-comment light
  syntaxKeyword: '#D6336C', // shiki token-keyword light
  syntaxFunction: '#6741D9', // shiki token-function light
  syntaxString: '#2F9E44', // shiki token-string light
  syntaxNumber: '#1C7ED6', // shiki token-constant light
  syntaxType: '#1971C2', // shiki token-link light
  syntaxOperator: '#495057', // shiki token-punctuation light
  syntaxPunctuation: '#495057',
}

const DARK_VARS: Record<string, string> = {
  cyan: '#679EFE', // deepseek-400 (state-business-primary dark)
  sky: '#679EFE', // deepseek-400
  blue: '#5686FE', // deepseek-450 (brand-primary-new dark)
  green: '#4ED17E', // green-400 (state-success-secondary dark)
  red: '#F25A5A', // red-400 (state-error-primary dark)
  yellow: '#F7AD31', // amber-400 (state-warn-secondary dark)
  violet: '#B197FC', // shiki token-function dark
  text: '#F9FAFB', // neutral-bluish-50 (label-primary dark)
  gray: '#CFD3D6', // neutral-bluish-300 (label-secondary dark)
  dimGray: '#ADB2B8', // neutral-bluish-400 (label-tertiary dark)
  darkGray: '#43454A', // neutral-bluish-750 (label-dimmed / borders)
  accent: '#4176E6', // deepseek-500
  selectedBg: '#34415B', // deepseek-800 (state-business-tertiary dark)
  userMsgBg: '#2C2C2E', // neutral-bluish-850 (specific-bubble dark)
  toolPendingBg: '#353638', // neutral-bluish-800 (bg-module-platform dark)
  toolSuccessBg: '#233C2C', // green-900 (state-success-tertiary dark)
  toolErrorBg: '#570C0C', // red-900
  customMsgBg: '#2c2740',
}

export let PALETTE_VARS: Record<string, string> = DARK_VARS

/** Semantic role → palette color (var name or literal hex), mirroring pi's `colors` section. */
const DARK_PALETTE_COLORS: Record<string, string> = {
  accent: 'accent',
  info: 'sky',
  border: 'blue',
  borderAccent: 'cyan',
  borderMuted: 'darkGray',
  success: 'green',
  error: 'red',
  warning: 'yellow',
  muted: 'gray',
  dim: 'dimGray',
  text: 'text',
  thinkingText: 'dimGray',
  thinkingL1: 'gray',
  thinkingL2: 'dimGray',
  thinkingL3: 'darkGray',

  selectedBg: 'selectedBg',
  scrollbarThumb: 'selectedBg',
  searchMatchBg: 'selectedBg',
  searchMatchText: 'text',
  userMessageBg: 'userMsgBg',
  userMessageText: 'text',
  customMessageBg: 'customMsgBg',
  customMessageText: 'text',
  customMessageLabel: '#B197FC', // shiki token-function dark
  toolPendingBg: 'toolPendingBg',
  toolSuccessBg: 'toolSuccessBg',
  toolErrorBg: 'toolErrorBg',
  toolTitle: 'text',
  toolOutput: 'gray',

  mdHeading: '#B7C8FE', // deepseek-300
  mdLink: '#74C0FC', // shiki token-link dark
  mdLinkUrl: 'dimGray',
  mdCode: '#74C0FC',
  mdCodeBlock: '#F9FAFB', // shiki foreground dark = label-primary
  mdCodeBlockBorder: 'darkGray',
  mdQuote: 'gray',
  mdQuoteBorder: 'darkGray',
  mdHr: 'darkGray',
  mdListBullet: 'accent',

  toolDiffAdded: 'green',
  toolDiffRemoved: 'red',
  toolDiffContext: 'gray',

  syntaxComment: '#ADB5BD', // shiki token-comment dark
  syntaxKeyword: '#FAA2C1', // shiki token-keyword dark
  syntaxFunction: '#B197FC', // shiki token-function dark
  syntaxVariable: 'text', // shiki leaves variables on the foreground
  syntaxString: '#69DB7C', // shiki token-string dark
  syntaxNumber: '#4DABF7', // shiki token-constant dark
  syntaxType: '#74C0FC', // shiki token-link dark
  syntaxOperator: '#CED4DA', // shiki token-punctuation dark
  syntaxPunctuation: '#CED4DA',
}

export let PALETTE_COLORS: Record<string, string> = DARK_PALETTE_COLORS

/** 一组「变量 + 语义角色」的完整色板（web/cc/pi/opencode 四预设各持 dark/light 两版）。 */
export interface PaletteSet {
  vars: Record<string, string>
  colors: Record<string, string>
}

/** web 预设（dsh web design token）：dark/light 两版。 */
export const WEB_PALETTE: Record<'dark' | 'light', PaletteSet> = {
  dark: { vars: DARK_VARS, colors: DARK_PALETTE_COLORS },
  light: { vars: LIGHT_PALETTE_VARS, colors: { ...DARK_PALETTE_COLORS, ...LIGHT_PALETTE_COLORS } },
}

/** Swap the process palette; call before any view is constructed（或换肤时先换后重建视图）。 */
export function applyPaletteSet(set: PaletteSet): void {
  PALETTE_VARS = set.vars
  PALETTE_COLORS = set.colors
}
