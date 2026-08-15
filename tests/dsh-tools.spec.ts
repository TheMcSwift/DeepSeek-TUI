/**
 * Specialized tool-result cards (web-parity batch): terminal pill, read card
 * with line numbers + highlighting, grep grouping, web citations — all driven
 * through the registry, rendering real pi components to rows.
 */

import { describe, expect, it } from 'vitest'
import { resolveToolDefinition } from '../src/view/pi-vendor/dsh-tools.ts'
import { theme } from '../src/view/theme/theme.ts'

const stripAnsi = (text: string): string => text.replace(/\x1b\[[0-9;]*[ -/]*[@-~]/g, '')

function renderResult(tool: string, result: unknown, args: Record<string, unknown> = {}, expanded = false): string {
  const definition = resolveToolDefinition(tool)
  const component = definition.renderResult!(result as never, { expanded, isPartial: false }, theme, { args } as never)
  return component.render(100).join('\n')
}

const text = (content: string) => ({ content: [{ type: 'text', text: content }], isError: false })

describe('specialized tool cards (web-parity batch)', () => {
  it('renders a terminal pill split off the exit marker (B4)', () => {
    const clean = renderResult('bash', text('total 4\nok'))
    expect(stripAnsi(clean)).toContain('✓ exit 0')
    expect(stripAnsi(clean)).not.toContain('[exit code:')

    const failed = renderResult('bash', text('oops\n[exit code: 3]'))
    expect(stripAnsi(failed)).toContain('✗ exit 3')
    expect(stripAnsi(failed)).not.toContain('[exit code: 3]')

    const killed = renderResult('bash', text('boom\n[killed by signal: SIGKILL]'))
    expect(stripAnsi(killed)).toContain('✗ killed by SIGKILL')
  })

  it('renders read results with line numbers and syntax colors (B6)', () => {
    const out = renderResult('read', text('const x = 1\n// note\nconsole.log(x)'), { file_path: '/src/a.ts' })
    const plain = stripAnsi(out)
    expect(plain).toContain('1 │ const x = 1')
    expect(plain).toContain('2 │ // note')
    expect(plain).toContain('3 │ console.log(x)')
    // The comment line picks up the syntax palette color.
    expect(out).toContain('\x1b[38;2;173;181;189m') // syntaxComment (shiki dark)
  })

  it('groups grep output by path with dim line numbers (B7)', () => {
    const out = renderResult('grep', text('src/a.ts:12:const x\ntests/b.ts:3:const y\nsrc/a.ts:20:return x'), {}, true)
    const plain = stripAnsi(out)
    expect(plain).toContain('src/a.ts')
    expect(plain).toContain('12 │ const x')
    expect(plain).toContain('20 │ return x')
    expect(plain).toContain('tests/b.ts')
  })

  it('lists glob paths (B7)', () => {
    const out = renderResult('glob', text('src/a.ts\nsrc/b.ts'))
    const plain = stripAnsi(out)
    expect(plain).toContain('src/a.ts')
    expect(plain).toContain('src/b.ts')
  })

  it('renders web_search citations from the structured meta (B8/A7)', () => {
    const out = renderResult('web_search', {
      content: [{ type: 'text', text: 'markdown-ish answer text' }],
      details: {
        meta: {
          answer: 'the provider answer',
          sources: [
            { url: 'https://example.com/a', title: 'Article A', snippet: 'snippet one' },
            { url: 'https://example.com/b' },
          ],
        },
      },
    }, { query: 'hello' })
    const plain = stripAnsi(out)
    expect(plain).toContain('the provider answer')
    expect(plain).toContain('引用来源（2）')
    expect(plain).toContain('[1] Article A')
    expect(plain).toContain('https://example.com/a')
    expect(plain).toContain('snippet one')
    // No title → hostname fallback.
    expect(plain).toContain('[2] example.com')
  })

  it('falls back to plain text for search results without structured meta', () => {
    const out = renderResult('web_search', text('just text'))
    expect(stripAnsi(out)).toContain('just text')
  })

  it('links tool paths and citation URLs with OSC 8 (B9/E14)', () => {
    // The read call row hyperlinks its path (encoded for file:// URIs).
    const call = resolveToolDefinition('read').renderCall!({ file_path: '/a b/c.ts' }, theme, {} as never)
    const callRows = call.render(100).join('')
    expect(callRows).toContain('\x1b]8;;file:///a%20b/c.ts\x1b\\')
    // Citation URLs link the same way.
    const search = renderResult('web_search', {
      content: [{ type: 'text', text: 'x' }],
      details: { meta: { sources: [{ url: 'https://example.com/a', title: 'A' }] } },
    }, { query: 'q' })
    expect(search).toContain('\x1b]8;;https://example.com/a\x1b\\')
  })
})
