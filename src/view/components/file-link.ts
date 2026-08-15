/**
 * OSC 8 hyperlinks for file paths and URLs (B9/E14): supported terminals
 * (iTerm2/kitty/wezterm/most VTE forks) open the target on Cmd/Ctrl-click,
 * while the visible label stays plain text everywhere else — a terminal's
 * stand-in for the web's clickable file-path links.
 * @module dsh-tui-app/view/components/file-link
 */

/** Wrap `label` in an OSC 8 hyperlink to `target` (path or http(s) URL). */
export function fileLink(target: string, label: string = target): string {
  const url = /^https?:\/\//i.test(target) ? target : `file://${encodeURI(target)}`
  return `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`
}
