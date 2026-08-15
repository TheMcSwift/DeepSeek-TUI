/** Type shim for the vendored components' keybinding imports. */
import '@earendil-works/pi-tui'

declare module '@earendil-works/pi-tui' {
  interface Keybindings {
    'app.interrupt': true
    'app.tools.expand': true
  }
}

export interface AppKeybinding {
  id?: string
  keys?: unknown[]
  description?: string
}
export interface KeybindingsManager {
  matches(data: string, action: string): boolean
  getKeys(action: string): string[]
}
