/**
 * The control-side approval seams: the `approval/request` waterfall (tool
 * permissions) as the chain-tail interactive answerer, and the
 * `userQuestions` UI provider (the agent asking the human). Both present
 * through one dialog presenter and fail closed.
 * @module dsh-tui-app/control/approvals
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-user-approval'
import { strings } from '../view/strings.ts'
import type { ApprovalOutcome } from '../document/document.ts'
import type { ApprovalAnswer, ApprovalQuestion } from '../view/components/approval-view.ts'

/** The single dialog presenter both seams share. */
export interface ApprovalPresenter {
  present(question: ApprovalQuestion): Promise<ApprovalAnswer>
}

/** Minimal question shape the userQuestions provider answers (verified fields). */
interface UserQuestion {
  id: string
  question: string
  detail?: string
  options?: Array<{ label: string; description?: string }>
  header?: string
  multiSelect?: boolean
  intent?: { kind?: string }
}

interface UserQuestionRequest {
  questions: UserQuestion[]
  signal?: AbortSignal
}

/** Request shape the approval waterfall delivers (verified fields). */
interface ApprovalRequestLike {
  agent: { id: string }
  toolName: string
  callId?: string
  reason?: string
  signal?: AbortSignal
}

/**
 * 审批问题富化（CC-02）：按 callId 回查文档里的工具调用，取回要执行的
 * 命令原文与影响文件行。由 runner 提供（文档只存在于 runner 的 fold 状态里）。
 */
export interface ApprovalEnricher {
  lookupToolCall(callId: string): { commandText?: string; impactLines?: string[] } | undefined
}

/**
 * Install both interactive answerer seams for the runner's agent.
 * @returns a disposer removing both registrations.
 */
export function installApprovals(
  ctx: Context,
  presenter: ApprovalPresenter,
  currentAgentId: () => string,
  timeoutMs = 120_000,
  enricher?: ApprovalEnricher,
): () => void {
  // Tool-permission waterfall: let earlier answerers (hooks, policies) decide;
  // only when nobody claimed the request (fail-closed 'unavailable') do we ask
  // the human.
  const disposeWaterfall = ctx.on('approval/request', async function (
    this: unknown,
    req: ApprovalRequestLike,
    next: () => Promise<ApprovalOutcome>,
  ): Promise<ApprovalOutcome> {
    if (req.agent.id !== currentAgentId()) return next()
    const earlier = await next()
    if (earlier !== 'unavailable') return earlier
    // CC-02: 把正在审批的命令原文/影响文件带进弹窗，用户按实际内容决策。
    const toolCall = req.callId !== undefined ? enricher?.lookupToolCall(req.callId) : undefined
    const answer = await presenter.present({
      title: `Approve tool call: ${req.toolName}?`,
      detail: req.reason,
      options: ['Allow once', 'Reject'],
      icon: '⚠',
      commandText: toolCall?.commandText,
      impactLines: toolCall?.impactLines,
    })
    if (req.signal?.aborted) return 'cancelled'
    if (answer.reason === 'picked' && answer.picked === 'Allow once') return 'allowed-once'
    if (answer.reason === 'picked' && answer.picked === 'Reject') return 'rejected'
    return answer.reason === 'timeout' ? 'unavailable' : 'cancelled'
  })

  // Agent-asks-human seam: one active provider per tree — the TUI is it.
  // (Optional at the service level: assemblies without the row skip it.)
  const disposeProvider = ctx.get('userQuestions')?.registerProvider({
    async ask(request: UserQuestionRequest): Promise<{ answers: Array<{ id: string; selected: string[]; custom?: string }> }> {
      const answers: Array<{ id: string; selected: string[]; custom?: string }> = []
      // Web parity (ui-user-questions QuestionComposer): the request can
      // carry several questions — present them one at a time with `i / n`
      // progress, and let the user go back to a previous question or skip
      // the current one (web `nav.prev` / `action.skip` copy).
      const total = request.questions.length
      let cursor = 0
      while (cursor < total) {
        if (request.signal?.aborted) break
        const question = request.questions[cursor]
        const options = question.options?.map(option => option.label) ?? []
        const optionDescriptions = question.options?.map(option => option.description)
        const intent = (question as { intent?: { kind?: string; approve?: string } }).intent
        const planReview = intent?.kind === 'plan-review'
        const answer = await presenter.present({
          title: question.question,
          detail: question.detail,
          options,
          optionDescriptions,
          detailMarkdown: planReview,
          approveLabel: intent?.approve,
          header: question.header,
          multiSelect: question.multiSelect === true,
          progress: total > 1 ? { index: cursor + 1, total } : undefined,
          // Plan reviews are approve/decline-only; the rest of the group can
          // go back to an earlier question or skip this one.
          backLabel: !planReview && cursor > 0 ? strings().prevQuestion : undefined,
          skipLabel: !planReview && options.length > 0 ? strings().skipQuestion : undefined,
        })
        if (answer.reason !== 'picked') break
        if (answer.back === true) {
          // Re-present the previous question; a re-answer replaces the entry.
          if (cursor > 0) cursor -= 1
          continue
        }
        if (answer.skipped === true) {
          cursor += 1
          continue
        }
        const picked = answer.pickedMultiple ?? (answer.picked !== undefined ? [answer.picked] : undefined)
        if (picked !== undefined) {
          // Option questions answer through the selected label; free-text
          // questions carry the typed text in the custom slot. Multi-select
          // answers carry the confirmed labels in `selected`. Going back and
          // re-answering replaces the earlier entry (one answer per id).
          const entry = options.length > 0
            ? { id: question.id, selected: picked }
            : { id: question.id, selected: [], custom: answer.picked }
          const existingIndex = answers.findIndex(item => item.id === question.id)
          if (existingIndex === -1) answers.push(entry)
          else answers[existingIndex] = entry
        }
        cursor += 1
      }
      return { answers }
    },
  } as never) ?? (() => {})

  void timeoutMs
  return () => {
    disposeWaterfall()
    disposeProvider()
  }
}
