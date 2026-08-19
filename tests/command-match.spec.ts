/**
 * 斜杠目录匹配排序：空查询字母序全量、查询按前缀加权 + 子序列打分、
 * 同分按显示名字母序（斜杠菜单稳定排序）。
 */

import { describe, expect, it } from 'vitest'
import { matchCommands } from '../src/app/pi/command-match.ts'
import type { CommandChoice } from '../src/app/terminal-app.ts'

const catalog: readonly CommandChoice[] = [
  { value: '__quit', label: '/quit · 退出 TUI', description: 'quit', aliases: ['exit'] },
  { value: '__queue', label: '/queue · 查看队列', description: 'queue' },
  { value: '__model', label: '/model <provider/model>', description: 'model', aliases: ['m'] },
  { value: '__help', label: '/hotkeys · 快捷键', description: 'help', aliases: ['?'] },
  { value: '__new', label: '/new · 新会话', description: 'new', aliases: ['clear'] },
]

describe('matchCommands 排序', () => {
  it('空查询返回按显示名字母序的全量目录（斜杠刚输入时的菜单顺序）', () => {
    const result = matchCommands(catalog, '')
    // 显示名：hotkeys, model, new, queue, quit → 字母序。
    expect(result.map(item => item.value)).toEqual(['__help', '__model', '__new', '__queue', '__quit'])
    // 输入目录本身未被改写（纯展示层排序，提交分辨率原序不受影响）。
    expect(catalog.map(item => item.value)).toEqual(['__quit', '__queue', '__model', '__help', '__new'])
  })

  it('同为前缀命中时按显示名字母序打破平局', () => {
    // 'q' 同时是 queue 与 quit 的前缀（分数相同）→ 字母序 queue 在前。
    expect(matchCommands(catalog, 'q').map(item => item.value)).toEqual(['__queue', '__quit'])
    expect(matchCommands(catalog, 'qu').map(item => item.value)).toEqual(['__queue', '__quit'])
  })

  it('前缀命中排在纯子序列命中之前（打分主键）', () => {
    const mixed: readonly CommandChoice[] = [
      { value: '__b', label: '/memo', description: '' }, // 'mo' 子序列命中（m…o）
      { value: '__a', label: '/model <provider/model>', description: '' }, // 'mo' 前缀命中
    ]
    expect(matchCommands(mixed, 'mo').map(item => item.value)).toEqual(['__a', '__b'])
  })

  it('显示名取首个词：带参数提示的标签按命令名排序', () => {
    const withHints: readonly CommandChoice[] = [
      { value: '__theme', label: '/theme [web|cc|pi|opencode]', description: '' },
      { value: '__model', label: '/model <provider/model>', description: '' },
    ]
    expect(matchCommands(withHints, '').map(item => item.value)).toEqual(['__model', '__theme'])
  })
})
