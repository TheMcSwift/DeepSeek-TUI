/**
 * @ 文件引用补全（B9，BACKLOG-CC-PARITY）：pi 的 @ fuzzy 补全依赖 fd 命令
 * （本地不保证安装，未提供 fdPath 时 @ 前缀直接无补全）——这里用深度受限的
 * 目录扫描实现等价能力：任意位置 `@` 触发、basename 匹配（`@ink` 命中
 * `src/ink/Box.js`）、目录深入、带空格路径自动 `@"path"` 引号；# 与其他前缀
 * 仍委托 pi 的路径补全。
 * 发送侧展开（文本文件内容/目录列表自动附加）见 pi-tui-app 的 expandAtReferences。
 * @module dsh-tui-app/app/at-file-autocomplete
 */

import { readdirSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { homedir } from 'node:os'

/** One completion row（与 pi 的 autocomplete items 同形）。 */
export interface AutocompleteItem {
  value: string
  label: string
  description?: string
}

/** pi 补全器的 getSuggestions 返回形。 */
export interface AutocompleteResult {
  items: AutocompleteItem[]
  prefix: string
}

/** 需要被包装的补全器的最小接口（pi 的 CombinedAutocompleteProvider 满足）。 */
export interface AutocompleteProviderLike {
  getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: { signal: AbortSignal; force?: boolean },
  ): Promise<AutocompleteResult | null>
  /** 补全应用（选中行如何替换文本）；@ 补全的 value 自带 @/引号，委托内层同语义。 */
  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number }
}

/** 提取光标前的 @ 前缀（含 `@"..."` 引号形式）；非 @ 上下文返回 null。 */
function extractAtPrefix(text: string): { raw: string; quoted: boolean } | null {
  const quoted = /@"([^"]*)$/.exec(text)
  if (quoted !== null) return { raw: quoted[1], quoted: true }
  const at = /(?:^|[\s(])@([^\s]*)$/.exec(text)
  if (at !== null) return { raw: at[1], quoted: false }
  return null
}

/** 展开 ~ 前缀（补全路径解析用）。 */
function expandHome(raw: string): string {
  if (raw.startsWith('~/')) return join(homedir(), raw.slice(2))
  if (raw === '~') return homedir()
  return raw
}

/**
 * 包装 pi 补全器：@ 前缀走自研扫描（basename 匹配），其余委托内层
 * （# 路径补全、Tab force 等保持 pi 行为）。
 */
export class AtFileAutocompleteProvider implements AutocompleteProviderLike {
  /** basename 扫描的最大递归深度（node_modules/.git 等已排除）。 */
  private static readonly SCAN_DEPTH = 3
  private static readonly MAX_RESULTS = 60
  private static readonly SKIP_DIRS = new Set(['node_modules', '.git', '.hg', '.svn', '.DS_Store', 'dist', 'build', '.pnpm-store', '__pycache__'])

  constructor(
    private readonly inner: AutocompleteProviderLike,
    private readonly basePath: string,
  ) {}

  async getSuggestions(lines: string[], cursorLine: number, cursorCol: number, options: { signal: AbortSignal }): Promise<AutocompleteResult | null> {
    const text = (lines[cursorLine] ?? '').slice(0, cursorCol)
    const at = extractAtPrefix(text)
    if (at !== null) {
      const items = this.atItems(at.raw, at.quoted)
      if (items.length === 0 || options.signal.aborted) return null
      return { items, prefix: text.slice(text.length - (at.raw.length + (at.quoted ? 2 : 1))) }
    }
    return this.inner.getSuggestions(lines, cursorLine, cursorCol, options)
  }

  /** 补全应用委托内层（value 已含 @/引号/目录尾斜杠，pi 的插入逻辑直接可用）。 */
  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    return this.inner.applyCompletion(lines, cursorLine, cursorCol, item, prefix)
  }

  /** @ 前缀的候选：路径段前缀匹配或 basename 扫描。 */
  private atItems(raw: string, quoted: boolean): AutocompleteItem[] {
    const expanded = expandHome(raw)
    if (expanded === '' || expanded.endsWith('/')) {
      // 根或目录内：列出该目录条目（前缀为空或目录名）。
      return this.listDir(expanded === '' ? '' : expanded, '', quoted)
    }
    const dir = dirname(expanded)
    const prefix = basename(expanded)
    if (dir !== '.' && dir !== '') {
      return this.listDir(dir, prefix, quoted)
    }
    // 无路径段：basename 扫描（@ink 命中 src/ink/Box.js）。
    return this.scanBasename(prefix, quoted)
  }

  /** 目录内的前缀匹配（相对 workspace）。 */
  private listDir(rel: string, prefix: string, quoted: boolean): AutocompleteItem[] {
    const dir = join(this.basePath, rel)
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const out: AutocompleteItem[] = []
    for (const entry of entries) {
      if (!entry.name.toLowerCase().startsWith(prefix.toLowerCase())) continue
      const isDir = entry.isDirectory()
      const path = rel === '' ? entry.name : `${rel}/${entry.name}`
      out.push({
        value: this.value(path, isDir, quoted),
        label: entry.name + (isDir ? '/' : ''),
        ...(rel === '' ? {} : { description: path }),
      })
    }
    return out
  }

  /** basename 扫描：深度受限递归，忽略 SKIP_DIRS；收集序 = 深度序（当前目录优先）。 */
  private scanBasename(prefix: string, quoted: boolean): AutocompleteItem[] {
    const out: AutocompleteItem[] = []
    const walk = (rel: string, depth: number): void => {
      if (depth > AtFileAutocompleteProvider.SCAN_DEPTH || out.length >= AtFileAutocompleteProvider.MAX_RESULTS) return
      let entries
      try {
        entries = readdirSync(join(this.basePath, rel), { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (out.length >= AtFileAutocompleteProvider.MAX_RESULTS) return
        if (AtFileAutocompleteProvider.SKIP_DIRS.has(entry.name)) continue
        if (!entry.name.toLowerCase().startsWith(prefix.toLowerCase())) continue
        const isDir = entry.isDirectory()
        const path = rel === '' ? entry.name : `${rel}/${entry.name}`
        out.push({
          value: this.value(path, isDir, quoted),
          label: entry.name + (isDir ? '/' : ''),
          ...(rel === '' ? {} : { description: path }),
        })
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || AtFileAutocompleteProvider.SKIP_DIRS.has(entry.name)) continue
        walk(rel === '' ? entry.name : `${rel}/${entry.name}`, depth + 1)
      }
    }
    walk('', 0)
    return out
  }

  /** 完成值：`@path`；含空格或已在引号内 → `@"path"`；目录尾 `/` 便于继续深入。 */
  private value(path: string, isDir: boolean, quoted: boolean): string {
    const suffix = isDir ? '/' : ''
    if (quoted || path.includes(' ')) return `@"${path}${suffix}"`
    return `@${path}${suffix}`
  }
}

/** 解析 @ 引用为一个绝对路径（发送侧展开用）；不存在返回 undefined。 */
export function resolveAtPath(basePath: string, path: string): { absolute: string; stat: { isDirectory(): boolean; size: number } } | undefined {
  const absolute = path.startsWith('~') ? join(homedir(), path.slice(1)) : join(basePath, path)
  try {
    const stat = statSync(absolute)
    return { absolute, stat }
  } catch {
    return undefined
  }
}
