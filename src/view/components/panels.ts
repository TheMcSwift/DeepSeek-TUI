/**
 * DSH-specific fixed panel: the active goal and todo list, rendered above the
 * transcript in pi's visual language. Pure view over document entries.
 * @module dsh-tui-app/view/components/panels
 */

import { truncateToWidth } from '@earendil-works/pi-tui'
import type { Component } from '@earendil-works/pi-tui'
import { fg } from '../../app/pi/color.ts'
import type { GoalEntry, TodoEntry, WorkflowView } from '../../document/document.ts'
import { formatDuration } from '../../projection/stats.ts'

/** One background-job row from the runner (T1⑥). */
export interface JobRow {
  id: string
  label: string
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  /** Epoch ms when the job registered (live elapsed time, E8). */
  startedAt?: number
  /** Epoch ms when the job settled; absent while running/stopping. */
  finishedAt?: number
}

/** Elapsed label: ms under a second, then the web's compact m/s format. */
function jobDuration(job: JobRow): string {
  if (job.startedAt === undefined) return ''
  const ms = Math.max(0, (job.finishedAt ?? Date.now()) - job.startedAt)
  return ms < 1000 ? `${ms}ms` : formatDuration(ms)
}

/**
 * 运行中 job 的呼吸条（CC-10，Claude Code 精灵的终端等价）：无总量概念的
 * 长期任务没有真进度，四帧脉冲只表达「还活着」。帧随 500ms ticker 的重绘
 * 前进，零新增定时器。
 */
const JOB_SPRITE_FRAMES = ['▐▓░░', '░▐▓░', '░░▐▓', '▓░░▐'] as const
function jobSprite(): string {
  return JOB_SPRITE_FRAMES[Math.floor(Date.now() / 500) % JOB_SPRITE_FRAMES.length] ?? ''
}

export class CapabilityPanel implements Component {
  private goal: GoalEntry | undefined
  private todo: TodoEntry | undefined
  private jobs: readonly JobRow[] = []
  private jobsExpanded = false
  private workflow: WorkflowView | undefined

  /** Update the panel from the document; returns true when anything changed. */
  set(goal: GoalEntry | undefined, todo: TodoEntry | undefined, jobs: readonly JobRow[] = [], workflow: WorkflowView | undefined = undefined): boolean {
    if (goal === this.goal && todo === this.todo && jobs === this.jobs && workflow === this.workflow) return false
    this.goal = goal
    this.todo = todo
    this.jobs = jobs
    this.workflow = workflow
    return true
  }

  /** P3: more than one job collapses to a single row until expanded. */
  setJobsExpanded(expanded: boolean): void {
    this.jobsExpanded = expanded
  }

  invalidate(): void {
    // No cached state to invalidate.
  }

  render(width: number): string[] {
    const lines: string[] = []
    if (this.goal !== undefined) {
      const goal = this.goal
      const marker = goal.phase === 'active'
        ? fg('success')('●')
        : goal.phase === 'blocked' ? fg('error')('■') : fg('muted')(goal.phase)
      lines.push(truncateToWidth(
        `${fg('accent')('◆ goal')} ${marker} ${fg('text')(goal.objective)} · ${fg('muted')(`round ${goal.roundsStarted}/${goal.maxGoalRounds}`)}`,
        width,
      ))
      if (goal.blockedReason !== undefined) {
        lines.push(truncateToWidth(`  ${fg('warning')(`blocked: ${goal.blockedReason}`)}`, width))
      }
    }
    if (this.todo !== undefined && this.todo.items.length > 0) {
      const items = this.todo.items
      const completed = items.filter(item => item.status === 'completed').length
      const inProgress = items.filter(item => item.status === 'in_progress').length
      const pending = items.length - completed - inProgress
      lines.push(truncateToWidth(
        `${fg('accent')('◆ todo')} ${fg('success')(`✓${completed}`)} ${fg('accent')(`▶${inProgress}`)} ${fg('muted')(`○${pending}`)}`,
        width,
      ))
      // Long lists fold to the first six items (web TodoPanel folds too).
      const shown = items.length <= 6 ? items : items.slice(0, 6)
      for (const item of shown) {
        const mark = item.status === 'completed'
          ? fg('success')('✓')
          : item.status === 'in_progress' ? fg('accent')('▶') : fg('muted')('○')
        const text = item.status === 'completed' ? fg('muted')(item.content) : fg('text')(item.content)
        lines.push(truncateToWidth(`${mark} ${text}`, width))
      }
      if (items.length > 6) {
        lines.push(truncateToWidth(fg('dim')(`  … 还有 ${items.length - 6} 项`), width))
      }
    }
    if (this.jobs.length > 1 && !this.jobsExpanded) {
      const running = this.jobs.filter(job => job.status === 'running' || job.status === 'stopping').length
      const runningPart = running > 0 ? ` · ${fg('accent')(`${running} ⟳`)}` : ''
      lines.push(truncateToWidth(`${fg('accent')(`◆ jobs ×${this.jobs.length}`)}${runningPart} · ${fg('dim')('Ctrl+O 展开')}`, width))
    } else if (this.jobs.length > 0) {
      const sprite = jobSprite()
      for (const job of this.jobs) {
        const running = job.status === 'running' || job.status === 'stopping'
        const mark = running
          ? `${fg('accent')(sprite)} ⟳`
          : job.status === 'failed' ? fg('error')('✗') : fg('muted')('✓')
        const duration = jobDuration(job)
        lines.push(truncateToWidth(
          `${fg('accent')('◆ job')} ${mark} ${fg('text')(job.label)} · ${fg('muted')(job.status)}${duration === '' ? '' : ` · ${fg('dim')(`⏱ ${duration}`)}`}`,
          width,
        ))
      }
    }
    // Workflow runs (E15/H32): one run row plus its members, folded to the
    // web's run → member disclosure (terminal-flattened, always expanded
    // while a run is active, capped at 8 member rows).
    const runs = this.workflow?.runs ?? []
    for (const run of runs.slice(-2)) {
      const settled = run.members.filter(member => member.outcome !== undefined).length
      const runningCount = run.members.length - settled
      const mark = run.state === 'running'
        ? fg('accent')('⟳')
        : run.state === 'completed' ? fg('success')('✓')
          : run.state === 'error' ? fg('error')('✗') : fg('muted')('⏹')
      const progress = `✓${settled}/${run.members.length}`
      lines.push(truncateToWidth(
        `${fg('accent')('◆ workflow')} ${mark} ${fg('text')(run.name)} · ${fg('muted')(progress)}${runningCount > 0 ? ` · ${fg('accent')(`${runningCount} ⟳`)}` : ''}`,
        width,
      ))
      const shown = run.members.slice(0, 8)
      for (const member of shown) {
        const memberMark = member.outcome === undefined
          ? fg('accent')('⟳')
          : member.outcome === 'completed' ? fg('success')('✓')
            : member.outcome === 'failed' ? fg('error')('✗') : fg('muted')('⏹')
        const phase = member.phase === undefined ? '' : ` · ${fg('dim')(member.phase)}`
        lines.push(truncateToWidth(`  ${memberMark} ${fg('text')(member.label)}${phase}`, width))
      }
      if (run.members.length > 8) {
        lines.push(truncateToWidth(fg('dim')(`  … 还有 ${run.members.length - 8} 名成员`), width))
      }
    }
    return lines
  }
}
