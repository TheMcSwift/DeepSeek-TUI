/**
 * A headless Terminal for driving the real pi-tui TUI in tests: records every
 * write, reports fixed dimensions, and feeds raw input bytes into the TUI's
 * input handler. No PTY, no raw mode — the TUI logic itself is under test.
 */

import type { Terminal } from '@earendil-works/pi-tui'

export class FakeTerminal implements Terminal {
  output = ''
  started = false
  stopped = false
  width = 100
  height = 30
  private onInputHandler?: (data: string) => void
  private onResizeHandler?: () => void

  get columns(): number {
    return this.width
  }

  get rows(): number {
    return this.height
  }

  get kittyProtocolActive(): boolean {
    return false
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.onInputHandler = onInput
    this.onResizeHandler = onResize
    this.started = true
  }

  stop(): void {
    this.stopped = true
  }

  async drainInput(): Promise<void> {
    await Promise.resolve()
  }

  write(data: string): void {
    this.output += data
  }

  moveBy(_lines: number): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(_title: string): void {}
  setProgress(_active: boolean): void {}

  /**
   * Feed raw terminal bytes into the TUI, split into one event per key or
   * complete escape sequence — the same shape ProcessTerminal's StdinBuffer
   * produces from a real keyboard.
   */
  feed(data: string): void {
    if (this.onInputHandler === undefined) throw new Error('FakeTerminal.feed before start')
    const tokens = data.split(/(\x1b\[[0-9;?]*[@-~])/).filter(token => token !== '')
    for (const token of tokens) {
      if (token.startsWith('\x1b')) this.onInputHandler(token)
      else for (const character of token) this.onInputHandler(character)
    }
  }

  /** Feed one whole byte chunk (e.g. `\x1b\x1b[A` for Alt+Up) without tokenizing. */
  feedRaw(data: string): void {
    if (this.onInputHandler === undefined) throw new Error('FakeTerminal.feedRaw before start')
    this.onInputHandler(data)
  }

  /** Simulate a terminal resize. */
  resize(width: number, height: number): void {
    this.width = width
    this.height = height
    this.onResizeHandler?.()
  }

  /** The raw written stream with ANSI sequences stripped, for assertions. */
  plain(): string {
    // strip SGR/CSI/OSC sequences; keep printable content and newlines
    return this.output
      .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
  }
}
