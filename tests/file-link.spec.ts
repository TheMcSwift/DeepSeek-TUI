/**
 * fileLink 的 OSC 8 协议白名单与注入防护回归：显式 scheme 只放行
 * http/https/mailto，控制字符剥离（ESC/BEL 逃逸防护），路径编码不变。
 */

import { describe, expect, it } from 'vitest'
import { fileLink, linkTarget } from '../src/view/components/file-link.ts'

const OSC8_OPEN = '\x1b]8;;'
const OSC8_CLOSE = '\x1b]8;;\x1b\\'

describe('fileLink protocol allowlist', () => {
  it('links http/https/mailto destinations', () => {
    expect(fileLink('https://example.com/a')).toBe(`${OSC8_OPEN}https://example.com/a\x1b\\https://example.com/a${OSC8_CLOSE}`)
    expect(fileLink('http://example.com')).toContain(`${OSC8_OPEN}http://example.com\x1b\\`)
    expect(fileLink('mailto:a@b.c')).toContain(`${OSC8_OPEN}mailto:a@b.c\x1b\\`)
  })

  it('drops disallowed schemes to plain text (web sanitizeUrl parity)', () => {
    for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'ftp://x/y', 'ssh://x']) {
      const out = fileLink(bad)
      expect(out).not.toContain('\x1b')
      expect(out).toBe(bad) // 标签原样保留，只是不再可点
    }
  })

  it('keeps encoding local paths into file:// URIs', () => {
    expect(fileLink('/a b/c.ts')).toBe(`${OSC8_OPEN}file:///a%20b/c.ts\x1b\\/a b/c.ts${OSC8_CLOSE}`)
    expect(linkTarget('C:\\work\\x.ts')).toBe('file://C:%5Cwork%5Cx.ts') // Windows 盘符不是 scheme
    expect(linkTarget('./rel/x')).toBe('file://./rel/x')
  })

  it('strips C0 controls that would escape the OSC 8 sequence', () => {
    const injection = 'https://ok.example/\x1b]8;;file:///etc/passwd\x1b\\'
    const out = fileLink(injection)
    // ESC 被剥离后注入载荷失去触发能力（残留正文只是 URL 里的普通文本）；
    // 输出中只剩包装自身的 4 个 ESC。
    expect(out.match(/\x1b/g)?.length ?? 0).toBe(4)
    expect(out).toContain('ok.example')
    // BEL 同样剥离。
    expect(fileLink('https://a\x07b').match(/\x07/)).toBeNull()
  })

  it('strips controls from the visible label too', () => {
    const out = fileLink('https://ok.example', 'bad\x1b]8;;x\x1b\\label')
    expect(out).not.toContain('\x1b]8;;x')
    expect(out).toContain('bad]8;;x')
  })

  it('returns undefined for empty targets', () => {
    expect(linkTarget('')).toBeUndefined()
    expect(linkTarget('\x1b\x07')).toBeUndefined()
  })
})
