/**
 * Skill-catalog → slash-command rows (G22/H33): user-invocable skills surface
 * in the `/` menu like the web's skill candidates; picking one inserts the
 * kebab-case name into the composer, which routes the model to the skill
 * tool on send. Pure mapping — the runner owns the registry access.
 * @module dsh-tui-app/skill-catalog
 */

import type { CommandChoice } from './app/terminal-app.ts'

/** Structural view of `ctx.skills.list()` entries (no dsh-skill import: the
 *  out-of-tree profile reads the service through an untyped seam). */
export interface SkillSummaryLike {
  name: string
  description: string
  whenToUse?: string
  invocation?: { userInvocable?: boolean }
}

/** Command value prefix; the runner inserts the bare name into the composer. */
export const SKILL_COMMAND_PREFIX = '__skill:'

/** Map the registry listing to slash-menu rows (user-invocable only). */
export function skillCommands(skills: readonly SkillSummaryLike[]): CommandChoice[] {
  return skills
    .filter(skill => skill.invocation?.userInvocable !== false)
    .map(skill => ({
      value: `${SKILL_COMMAND_PREFIX}${skill.name}`,
      label: `/${skill.name} · ${skill.description}`,
      description: skill.whenToUse === undefined ? 'skill' : `skill · ${skill.whenToUse}`,
    }))
}
