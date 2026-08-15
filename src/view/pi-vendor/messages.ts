/** Type shim for the compaction summary message component. */
export interface CompactionSummaryMessage {
  tokensBefore: number
  summary: string
  provider?: string
  model?: string
}
