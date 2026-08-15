/**
 * The DSH tool-definition registry for the vendored ToolExecutionComponent:
 * view-only renderers keyed by DSH tool name. `execute` is deliberately
 * absent — the DSH runtime executes tools; these definitions only render
 * their calls and results (with diff cards from `FsDiffMeta`).
 * @module dsh-tui-app/view/pi-vendor/dsh-tools
 */

import { Text } from '@earendil-works/pi-tui'
import type { Component } from '@earendil-works/pi-tui'
import type { ToolDefinition } from './extensions-types.ts'
import type { Theme } from '../theme/theme.ts'
import { theme } from '../theme/theme.ts'
import { renderDiff } from './diff.ts'
import { getTextOutput } from './render-utils.ts'
import { highlight, supportsLanguage } from '../../app/pi/highlight.ts'
import type { HighlightTheme } from '../../app/pi/highlight.ts'
import { truncateToVisualLines } from './visual-truncate.ts'
import { fileLink } from '../components/file-link.ts'

interface DshToolArgs {
  [key: string]: unknown
}

/** Diff payload carried on DSH write/edit tool results (FsDiffMeta). */
interface FsDiffMeta {
  diffs: Array<{ path: string; oldText: string | null; newText: string }>
}

/** Parsed args with a raw fallback for unparseable JSON. */
function parseArgs(raw: string): DshToolArgs {
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed !== null && typeof parsed === 'object' ? parsed as DshToolArgs : { _raw: raw }
  } catch {
    return { _raw: raw }
  }
}

const RESULT_PREVIEW_LINES = 6

/** Generic result renderer: text output, truncated with a count, expandable. */
function textResult(
  result: { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean },
  options: { expanded: boolean },
  theme: Theme,
): Component {
  const output = result.content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
  const style = result.isError === true
    ? (text: string) => theme.fg('error', text)
    : (text: string) => theme.fg('toolOutput', text)
  // read_image returns image blocks; terminals here render no inline
  // images, so record them as a visible placeholder instead of dropping.
  const images = result.content.filter(block => block.type === 'image')
  const imageNote = images.length === 0
    ? ''
    : `\n${theme.fg('dim', `🖼 已读取 ${images.length} 张图像（终端未启用内联图片渲染）`)}`
  const lines = output.split('\n')
  if (options.expanded || lines.length <= RESULT_PREVIEW_LINES) {
    return new Text(style(output) + imageNote, 0, 0)
  }
  const preview = lines.slice(0, RESULT_PREVIEW_LINES).join('\n')
  const note = theme.fg('dim', `… 还有 ${lines.length - RESULT_PREVIEW_LINES} 行（⏎ 展开）`)
  return new Text(`${style(preview)}\n${note}${imageNote}`, 0, 0)
}

/** Bash-style call: the command line. */
function commandCall(args: DshToolArgs, theme: Theme): Component {
  const command = typeof args.command === 'string' ? args.command : typeof args.cmd === 'string' ? args.cmd : ''
  return new Text(theme.fg('toolTitle', `$ ${command}`), 0, 0)
}

/** File-tool call: the path (an OSC 8 hyperlink where terminals support it). */
function pathCall(args: DshToolArgs, theme: Theme): Component {
  const path = typeof args.file_path === 'string' ? args.file_path : typeof args.path === 'string' ? args.path : ''
  return new Text(theme.fg('toolTitle', path === '' ? '' : fileLink(path)), 0, 0)
}

/** Web-tool call: the query/url. */
function queryCall(args: DshToolArgs, theme: Theme): Component {
  const query = typeof args.query === 'string' ? args.query : typeof args.url === 'string' ? args.url : ''
  const url = typeof args.url === 'string' ? args.url : ''
  return new Text(theme.fg('toolTitle', url === '' ? query : fileLink(url, query)), 0, 0)
}

/** Diff result: pi's word-level diff cards for every hunk. */
function diffResult(
  result: { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean; details?: { meta?: FsDiffMeta } },
  _options: { expanded: boolean },
  theme: Theme,
): Component {
  const diffs = result.details?.meta?.diffs ?? []
  const lines: string[] = []
  for (const diff of diffs) {
    lines.push(theme.fg('toolTitle', fileLink(diff.path)))
    // pi's renderDiff consumes a numbered unified diff; rebuild one per hunk.
    const numbered: string[] = []
    for (const [i, line] of (diff.oldText ?? '').split('\n').entries()) numbered.push(`-${i + 1} ${line}`)
    for (const [i, line] of diff.newText.split('\n').entries()) numbered.push(`+${i + 1} ${line}`)
    lines.push(...renderDiff(numbered.join('\n')).split('\n'))
  }
  const output = lines.join('\n')
  return new Text(output === '' ? theme.fg('toolOutput', '(no changes)') : output, 0, 0)
}

/** The joined plain-text body of a tool result. */
function resultText(result: { content: Array<{ type: string; text?: string; data?: string }> }): string {
  return result.content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => block.text as string)
    .join('\n')
}

/**
 * Exit-status marker contract ported from `@deepseek-ai/dsh-shell/render`
 * (parseExitStatus): `\n[exit code: N]` / `\n[killed by signal: X]` trail the
 * shell tools' rendered output; the terminal card splits them into a pill.
 */
function parseExitStatus(text: string): { body: string; exitCode?: number; signal?: string } {
  const signal = /\n\[killed by signal: ([^\]\n]+)\]$/.exec(text)
  if (signal?.[1] !== undefined) return { body: text.slice(0, signal.index), signal: signal[1] }
  const exit = /\n\[exit code: (\d+)\]$/.exec(text)
  if (exit?.[1] !== undefined) return { body: text.slice(0, exit.index), exitCode: Number(exit[1]) }
  return { body: text }
}

/** Truncate long bodies with the shared preview note, honoring `expanded`. */
function truncateBody(text: string, options: { expanded: boolean }, theme: Theme, limit = RESULT_PREVIEW_LINES): string {
  const lines = text.split('\n')
  if (options.expanded || lines.length <= limit) return text
  const preview = lines.slice(0, limit).join('\n')
  return `${preview}\n${theme.fg('dim', `… 还有 ${lines.length - limit} 行（⏎ 展开）`)}`
}

/** Terminal card (B4): exit pill split off the marker, body kept verbatim
 *  (ANSI passes through), truncated with the shared note. */
function terminalResult(
  result: { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean },
  options: { expanded: boolean },
  theme: Theme,
): Component {
  const { body, exitCode, signal } = parseExitStatus(resultText(result))
  const pill = signal !== undefined
    ? theme.fg('error', `✗ killed by ${signal}`)
    : exitCode !== undefined && exitCode !== 0
      ? theme.fg('error', `✗ exit ${exitCode}`)
      : result.isError === true
        ? theme.fg('error', '✗ 失败')
        : theme.fg('success', '✓ exit 0')
  const style = result.isError === true
    ? (text: string) => theme.fg('error', text)
    : (text: string) => theme.fg('toolOutput', text)
  const bodyOut = truncateBody(body, options, theme)
  return new Text(`${pill}\n${style(bodyOut)}`, 0, 0)
}

/** hljs scopes on the web-shiki palette (same mapping as app/pi/theme.ts). */
const READ_HIGHLIGHT_THEME: HighlightTheme = {
  comment: text => theme.fg('syntaxComment', text),
  keyword: text => theme.fg('syntaxKeyword', text),
  built_in: text => theme.fg('syntaxKeyword', text),
  literal: text => theme.fg('syntaxKeyword', text),
  'title.function': text => theme.fg('syntaxFunction', text),
  'title.class': text => theme.fg('syntaxType', text),
  function: text => theme.fg('syntaxFunction', text),
  variable: text => theme.fg('syntaxVariable', text),
  params: text => theme.fg('syntaxVariable', text),
  string: text => theme.fg('syntaxString', text),
  number: text => theme.fg('syntaxNumber', text),
  type: text => theme.fg('syntaxType', text),
  operator: text => theme.fg('syntaxOperator', text),
  punctuation: text => theme.fg('syntaxPunctuation', text),
  default: text => text,
}

const READ_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', c: 'c', h: 'c', cpp: 'cpp',
  sh: 'bash', zsh: 'bash', yml: 'yaml', yaml: 'yaml', toml: 'ini', md: 'markdown', html: 'html', css: 'css',
  sql: 'sql', lua: 'lua', kt: 'kotlin', swift: 'swift', php: 'php', xml: 'xml', dockerfile: 'dockerfile',
}

/** Read card (B6): line numbers + syntax-highlighted file window. */
function readResult(
  result: { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean },
  options: { expanded: boolean },
  theme: Theme,
  context: { args: DshToolArgs },
): Component {
  const text = resultText(result)
  const path = typeof context.args.file_path === 'string' ? context.args.file_path : ''
  const extension = path.includes('.') ? (path.split('.').pop() ?? '').toLowerCase() : ''
  const language = READ_LANGUAGE_BY_EXTENSION[extension]
  const lang = language !== undefined && supportsLanguage(language) ? language : undefined
  const lines = text.split('\n')
  const limit = 40
  const shown = options.expanded || lines.length <= limit ? lines : lines.slice(0, limit)
  const width = String(Math.max(1, lines.length)).length
  const rows: string[] = []
  for (const [index, line] of shown.entries()) {
    const no = String(index + 1).padStart(width, ' ')
    const styled = lang === undefined
      ? theme.fg('toolOutput', line)
      : highlight(line, { language: lang, ignoreIllegals: true, theme: READ_HIGHLIGHT_THEME })
    rows.push(`${theme.fg('dim', `${no} │`)} ${styled}`)
  }
  let output = rows.join('\n')
  if (!options.expanded && lines.length > limit) {
    output += `\n${theme.fg('dim', `… 还有 ${lines.length - limit} 行（⏎ 展开）`)}`
  }
  return new Text(output, 0, 0)
}

/** Search card (B7): ripgrep-style `path:line:content` grouped by path. */
function grepResult(
  result: { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean },
  options: { expanded: boolean },
  theme: Theme,
): Component {
  const lines = resultText(result).split('\n')
  interface Group { path: string; matches: Array<{ no: string; text: string }> }
  const groups: Group[] = []
  let current: Group | undefined
  for (const line of lines) {
    const match = /^(.+?):(\d+):(.*)$/.exec(line)
    if (match === null) continue
    if (current === undefined || current.path !== match[1]) {
      current = { path: match[1], matches: [] }
      groups.push(current)
    }
    current.matches.push({ no: match[2], text: match[3] })
  }
  if (groups.length === 0) return textResult(result, options, theme)
  const rows: string[] = []
  const limit = 40
  let emitted = 0
  let truncated = false
  for (const group of groups) {
    rows.push(theme.fg('toolTitle', fileLink(group.path)))
    for (const match of group.matches) {
      if (!options.expanded && emitted >= limit) {
        truncated = true
        break
      }
      rows.push(`${theme.fg('dim', `${match.no} │`)} ${theme.fg('toolOutput', match.text)}`)
      emitted++
    }
    if (truncated) break
  }
  let output = rows.join('\n')
  if (truncated) {
    const total = groups.reduce((sum, group) => sum + group.matches.length, 0)
    output += `\n${theme.fg('dim', `… 还有 ${total - emitted} 条匹配（⏎ 展开）`)}`
  }
  return new Text(output, 0, 0)
}

/** Glob card (B7): the path list, one per line. */
function globResult(
  result: { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean },
  options: { expanded: boolean },
  theme: Theme,
): Component {
  const lines = resultText(result).split('\n').filter(line => line.trim() !== '')
  if (lines.length === 0) return textResult(result, options, theme)
  const limit = 40
  const shown = options.expanded || lines.length <= limit ? lines : lines.slice(0, limit)
  let output = shown.map(line => theme.fg('toolOutput', line)).join('\n')
  if (!options.expanded && lines.length > limit) {
    output += `\n${theme.fg('dim', `… 还有 ${lines.length - limit} 条路径（⏎ 展开）`)}`
  }
  return new Text(output, 0, 0)
}

/** web_search meta carried on the tool/result event (dsh tool-web contract). */
interface WebSearchMeta {
  sources: Array<{ url: string; title?: string; snippet?: string; publishedAt?: string }>
  truncated?: boolean
  answer?: string
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** Web search card (B8 + A7): provider answer + ordered citation list. */
function webSearchResult(
  result: { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean; details?: { meta?: unknown } },
  options: { expanded: boolean },
  theme: Theme,
): Component {
  const meta = result.details?.meta as WebSearchMeta | undefined
  const sources = meta?.sources
  if (sources === undefined || sources.length === 0) return textResult(result, options, theme)
  const lines: string[] = []
  if (meta?.answer !== undefined && meta.answer !== '') {
    lines.push(theme.fg('toolOutput', meta.answer), '')
  }
  lines.push(theme.fg('toolTitle', `引用来源（${sources.length}${meta?.truncated === true ? '+' : ''}）`))
  sources.forEach((source, index) => {
    const title = source.title ?? hostnameOf(source.url)
    lines.push(theme.fg('text', `[${index + 1}] ${title === '' ? fileLink(source.url) : title}`))
    lines.push(theme.fg('dim', `    ${fileLink(source.url)}`))
    if (source.snippet !== undefined && source.snippet !== '') {
      const snippet = source.snippet.length > 120 ? `${source.snippet.slice(0, 119)}…` : source.snippet
      lines.push(theme.fg('muted', `    ${snippet}`))
    }
  })
  return new Text(lines.join('\n'), 0, 0)
}

/** web_fetch card (B8): fetched URL header + body. */
function webFetchResult(
  result: { content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean },
  options: { expanded: boolean },
  theme: Theme,
  context: { args: DshToolArgs },
): Component {
  const url = typeof context.args.url === 'string' ? context.args.url : ''
  const style = result.isError === true
    ? (text: string) => theme.fg('error', text)
    : (text: string) => theme.fg('toolOutput', text)
  const header = url === '' ? '' : `${theme.fg('toolTitle', fileLink(url))}\n`
  return new Text(`${header}${style(truncateBody(resultText(result), options, theme))}`, 0, 0)
}

/** The complete DSH tool registry. */
export const dshToolDefinitions: Record<string, ToolDefinition<DshToolArgs, unknown, unknown>> = {
  bash: { name: 'bash', label: 'bash', description: '', renderCall: (a, t) => commandCall(a, t), renderResult: (r, o, t) => terminalResult(r as never, o, t) },
  pwsh: { name: 'pwsh', label: 'pwsh', description: '', renderCall: (a, t) => commandCall(a, t), renderResult: (r, o, t) => terminalResult(r as never, o, t) },
  read: { name: 'read', label: 'read', description: '', renderCall: (a, t) => pathCall(a, t), renderResult: (r, o, t, c) => readResult(r as never, o, t, c as never) },
  read_image: { name: 'read_image', label: 'read_image', description: '', renderCall: (a, t) => pathCall(a, t), renderResult: (r, o, t) => textResult(r, o, t) },
  write: { name: 'write', label: 'write', description: '', renderCall: (a, t) => pathCall(a, t), renderResult: (r, o, t) => diffResult(r as never, o, t) },
  edit: { name: 'edit', label: 'edit', description: '', renderCall: (a, t) => pathCall(a, t), renderResult: (r, o, t) => diffResult(r as never, o, t) },
  'str-replace-editor': { name: 'str-replace-editor', label: 'str-replace-editor', description: '', renderCall: (a, t) => pathCall(a, t), renderResult: (r, o, t) => diffResult(r as never, o, t) },
  grep: { name: 'grep', label: 'grep', description: '', renderCall: (a, t) => pathCall(a, t), renderResult: (r, o, t) => grepResult(r as never, o, t) },
  glob: { name: 'glob', label: 'glob', description: '', renderCall: (a, t) => pathCall(a, t), renderResult: (r, o, t) => globResult(r as never, o, t) },
  web_search: { name: 'web_search', label: 'web_search', description: '', renderCall: (a, t) => queryCall(a, t), renderResult: (r, o, t) => webSearchResult(r as never, o, t) },
  web_fetch: { name: 'web_fetch', label: 'web_fetch', description: '', renderCall: (a, t) => queryCall(a, t), renderResult: (r, o, t, c) => webFetchResult(r as never, o, t, c as never) },
}

/** Fallback for unregistered tools (MCP and other plugins). */
export function fallbackToolDefinition(name: string): ToolDefinition<DshToolArgs, unknown, unknown> {
  return {
    name,
    label: name,
    description: '',
    renderCall: (a, t) => new Text(themeTitle(t, `${name} ${JSON.stringify(a)}`), 0, 0),
    renderResult: (r, o, t) => textResult(r, o, t),
  }
}

function themeTitle(theme: Theme, text: string): string {
  return theme.fg('toolTitle', text)
}

/** Resolve a definition for a DSH tool call. */
export function resolveToolDefinition(name: string): ToolDefinition<DshToolArgs, unknown, unknown> {
  return dshToolDefinitions[name] ?? fallbackToolDefinition(name)
}

/** Shared helpers for the view layer. */
export function toolArgs(raw: string): DshToolArgs {
  return parseArgs(raw)
}

export function toolOutputText(content: Array<{ type: string; text?: string; data?: string }>): string {
  return getTextOutput({ content } as never, false) || content.filter(b => b.type === 'text').map(b => b.text ?? '').join('\n')
}

export { truncateToVisualLines }

/** pi-compatible factory the vendored tool-execution component expects. */
export function createAllToolDefinitions(_cwd: string): Record<string, ToolDefinition<DshToolArgs, unknown, unknown>> {
  return dshToolDefinitions
}

export type ToolName = string
