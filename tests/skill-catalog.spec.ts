/**
 * Skill-catalog → slash-menu rows (G22/H33): user-invocable filtering and the
 * command value the runner maps to composer insertion.
 */

import { describe, expect, it } from 'vitest'
import { SKILL_COMMAND_PREFIX, skillCommands } from '../src/skill-catalog.ts'
import type { SkillSummaryLike } from '../src/skill-catalog.ts'

const skill = (name: string, over: Partial<SkillSummaryLike> = {}): SkillSummaryLike =>
  ({ name, description: `${name} does things`, ...over })

describe('skill catalog rows (G22/H33)', () => {
  it('maps user-invocable skills to slash rows', () => {
    const rows = skillCommands([
      skill('audit', { whenToUse: 'checking dependencies', invocation: { userInvocable: true } }),
      skill('build'),
    ])
    expect(rows).toEqual([
      { value: '__skill:audit', label: '/audit · audit does things', description: 'skill · checking dependencies' },
      { value: '__skill:build', label: '/build · build does things', description: 'skill' },
    ])
  })

  it('excludes skills that are not user-invocable', () => {
    const rows = skillCommands([
      skill('model-only', { invocation: { userInvocable: false } }),
      skill('public', { invocation: { userInvocable: true } }),
    ])
    expect(rows.map(row => row.value)).toEqual([`${SKILL_COMMAND_PREFIX}public`])
  })

  it('treats a missing invocation policy as invocable', () => {
    expect(skillCommands([skill('open')]).map(row => row.value)).toEqual([`${SKILL_COMMAND_PREFIX}open`])
  })
})
