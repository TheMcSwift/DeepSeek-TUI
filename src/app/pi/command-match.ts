/**
 * 斜杠命令匹配与权限徽标着色（CC-01/CC-03）：从 pi-tui-app.ts 拆出的纯函数，
 * 无组件依赖。子序列打分容忍拼写省略（Claude Code 式模糊补全），权限值按
 * 危险等级分色。
 * @module dsh-tui-app/app/pi/command-match
 */

import { fg } from './color.ts'
import type { CommandChoice } from '../terminal-app.ts'

/**
 * 子序列匹配打分（CC-03）：query 逐字符按顺序命中 target 即得分，连续命中
 * 加权；不能按序命中返回 -1。调用方保证两者均已 lowercase。前缀命中由
 * matchCommands 额外加权，保证精确前缀永远排在模糊命中之前。
 */
export function subsequenceScore(query: string, target: string): number {
  let qi = 0
  let score = 0
  let streak = 0
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) {
      qi++
      streak++
      score += 1 + streak * 2
    } else {
      streak = 0
    }
  }
  return qi === query.length ? score : -1
}

/**
 * 权限预设值按危险等级着色（CC-01，Claude Code 权限徽标语义）：full-access
 * 红、workspace-write 蓝、read-only 暗灰，一眼可辨当前权限面。
 */
export function permissionTone(value: string): (text: string) => string {
  if (value.includes('full-access')) return (text: string) => fg('error')(text)
  if (value.includes('workspace-write')) return (text: string) => fg('info')(text)
  if (value.includes('read-only')) return (text: string) => fg('dim')(text)
  return (text: string) => fg('text')(text)
}

/** 目录行匹配：空查询返回全量；否则按前缀加权 + 子序列打分排序（稳定）。 */
export function matchCommands(catalog: readonly CommandChoice[], query: string): CommandChoice[] {
  if (query === '') return [...catalog]
  const scored: Array<{ item: CommandChoice; score: number }> = []
  for (const item of catalog) {
    const label = item.label.startsWith('/') ? item.label.slice(1).toLowerCase() : item.label.toLowerCase()
    const candidates = [item.value, ...(item.aliases ?? []), label]
    let best = -1
    for (const candidate of candidates) {
      const prefix = candidate.startsWith(query) ? 4 : 0 // 前缀命中优先
      const fuzzy = subsequenceScore(query, candidate)
      if (fuzzy >= 0 && prefix + fuzzy > best) best = prefix + fuzzy
    }
    if (best >= 0) scored.push({ item, score: best })
  }
  // 稳定排序：同分保持目录原序。
  return scored.sort((a, b) => b.score - a.score).map(entry => entry.item)
}
