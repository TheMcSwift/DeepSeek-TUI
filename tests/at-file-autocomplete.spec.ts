/**
 * @ 文件引用补全（B9）：自研扫描器——basename 匹配、路径段前缀、目录深入、
 * @"path" 引号；发送侧附加由 pi-tui-app.spec 的 accept 路径覆盖。
 */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AtFileAutocompleteProvider, resolveAtPath } from '../src/app/at-file-autocomplete.ts'

let dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fixture(): { base: string; provider: AtFileAutocompleteProvider } {
  const base = join(tmpdir(), `dsh-tui-at-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  dirs.push(base)
  mkdirSync(join(base, 'src', 'ink'), { recursive: true })
  mkdirSync(join(base, 'docs'), { recursive: true })
  writeFileSync(join(base, 'src', 'ink', 'Box.js'), 'export const box = 1\n')
  writeFileSync(join(base, 'src', 'main.ts'), 'main\n')
  writeFileSync(join(base, 'docs', 'guide.md'), 'guide text\n')
  writeFileSync(join(base, 'README.md'), '# readme\n')
  const inner = {
    getSuggestions: async () => null,
    applyCompletion: (_lines: string[], _line: number, _col: number, _item: { value: string; label: string }, _prefix: string) => ({ lines: [] as string[], cursorLine: 0, cursorCol: 0 }),
  }
  return { base, provider: new AtFileAutocompleteProvider(inner, base) }
}

const signal = new AbortController().signal

describe('AtFileAutocompleteProvider (B9)', () => {
  it('matches basenames across the tree: @ink finds src/ink/, @Box finds src/ink/Box.js', async () => {
    const { provider } = fixture()
    const result = await provider.getSuggestions(['see @ink'], 0, 8, { signal })
    expect(result).not.toBeNull()
    const labels = result!.items.map((item: { label: string }) => item.label)
    expect(labels).toContain('ink/')
    // 跨深度的 basename 前缀匹配（@Box 命中 src/ink/Box.js）。
    const deep = await provider.getSuggestions(['see @Box'], 0, 8, { signal })
    expect(deep).not.toBeNull()
    expect(deep!.items.some((item: { label: string }) => item.label === 'Box.js')).toBe(true)
    // value 带 @ 前缀；目录带尾斜杠。
    const dirItem = result!.items.find((item: { label: string }) => item.label === 'ink/')
    expect(dirItem?.value).toBe('@src/ink/')
    // 深层文件的 description 显示相对路径。
    const fileItem = deep!.items.find((item: { label: string }) => item.label === 'Box.js')
    expect(fileItem?.description).toBe('src/ink/Box.js')
  })

  it('completes a path segment prefix: @src/in narrows inside src/', async () => {
    const { provider } = fixture()
    const result = await provider.getSuggestions(['@src/in'], 0, 7, { signal })
    expect(result).not.toBeNull()
    expect(result!.items.some((item: { label: string }) => item.label === 'ink/')).toBe(true)
    expect(result!.items.some((item: { label: string }) => item.label === 'main.ts')).toBe(false)
  })

  it('lists a directory when the prefix ends with a slash: @docs/', async () => {
    const { provider } = fixture()
    const result = await provider.getSuggestions(['@docs/'], 0, 6, { signal })
    expect(result).not.toBeNull()
    expect(result!.items.map((item: { label: string }) => item.label)).toEqual(['guide.md'])
  })

  it('quotes paths containing spaces: @"dir name" and value with quotes', async () => {
    const base = join(tmpdir(), `dsh-tui-at-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    dirs.push(base)
    mkdirSync(join(base, 'dir name'), { recursive: true })
    writeFileSync(join(base, 'dir name', 'file.txt'), 'x')
    const inner = { getSuggestions: async () => null, applyCompletion: (_lines: string[], _line: number, _col: number, _item: { value: string; label: string }, _prefix: string) => ({ lines: [] as string[], cursorLine: 0, cursorCol: 0 }) }
    const provider = new AtFileAutocompleteProvider(inner, base)
    // @"dir 前缀（引号内）：补全出带引号的 value。
    const quoted = await provider.getSuggestions(['@"dir'], 0, 5, { signal })
    expect(quoted).not.toBeNull()
    expect(quoted!.items[0]?.value).toBe('@"dir name/"')
    // 无引号但结果含空格 → value 自动加引号。
    const plain = await provider.getSuggestions(['@dir'], 0, 4, { signal })
    expect(plain).not.toBeNull()
    expect(plain!.items[0]?.value).toBe('@"dir name/"')
  })

  it('delegates non-@ prefixes to the inner provider', async () => {
    const { base } = fixture()
    let delegated = false
    const inner = {
      getSuggestions: async () => { delegated = true; return null },
      applyCompletion: (_lines: string[], _line: number, _col: number, _item: { value: string; label: string }, _prefix: string) => ({ lines: [] as string[], cursorLine: 0, cursorCol: 0 }),
    }
    const provider = new AtFileAutocompleteProvider(inner, base)
    await provider.getSuggestions(['#src/'], 0, 6, { signal })
    expect(delegated).toBe(true)
  })

  it('resolveAtPath resolves workspace-relative paths and misses unknown ones', () => {
    const { base } = fixture()
    const hit = resolveAtPath(base, 'README.md')
    expect(hit).not.toBeUndefined()
    expect(hit!.stat.isDirectory()).toBe(false)
    const dir = resolveAtPath(base, 'docs')
    expect(dir?.stat.isDirectory()).toBe(true)
    expect(resolveAtPath(base, 'nope.md')).toBeUndefined()
  })
})
