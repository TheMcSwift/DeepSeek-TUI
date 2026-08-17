/**
 * OSC 8 hyperlinks for file paths and URLs (B9/E14): supported terminals
 * (iTerm2/kitty/wezterm/most VTE forks) open the target on Cmd/Ctrl-click,
 * while the visible label stays plain text everywhere else — a terminal's
 * stand-in for the web's clickable file-path links.
 *
 * 安全策略（对齐 web sanitizeUrl：link destinations pass a protocol
 * allowlist）：
 * - 显式 scheme 只允许 http/https/mailto，其余（javascript:/data:/file: 等）
 *   降级为纯文本标签——模型输出无法借 OSC 8 诱骗点击。
 * - 无 scheme 的目标按本地路径处理（工具卡路径），encodeURI 兜底编码。
 * - 目标与标签一律剥离 C0 控制字符：ESC/BEL 会逃逸出 OSC 8 序列注入终端
 *   指令，这是终端超链接的经典注入面。
 * @module dsh-tui-app/view/components/file-link
 */

/** 显式 scheme 的协议白名单（与 web sanitizeUrl 对齐）。 */
const LINK_PROTOCOL_ALLOWLIST = new Set(['http:', 'https:', 'mailto:'])

/** 剥离会逃逸 OSC 8 序列的 C0 控制字符。 */
function stripControls(text: string): string {
  return text.replace(/[\x00-\x1f\x7f]/g, '')
}

/** Windows 盘符（`C:\…`）不是 scheme，按路径处理。 */
function isWindowsDrivePath(target: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(target)
}

/**
 * 把目标规整为可嵌入 OSC 8 的 URL；协议不允许或不可用（如空目标）时返回
 * `undefined`，调用方应降级渲染纯文本标签。
 */
export function linkTarget(target: string): string | undefined {
  const clean = stripControls(target)
  if (clean === '') {
    return undefined
  }
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(clean)?.[1]
  if (scheme !== undefined && !isWindowsDrivePath(clean)) {
    return LINK_PROTOCOL_ALLOWLIST.has(`${scheme.toLowerCase()}:`) ? clean : undefined
  }
  // 无 scheme（或 Windows 盘符）：本地路径 → file://。
  return `file://${encodeURI(clean)}`
}

/** Wrap `label` in an OSC 8 hyperlink to `target` (path or allowlisted URL). */
export function fileLink(target: string, label: string = target): string {
  const cleanLabel = stripControls(label)
  const url = linkTarget(target)
  return url === undefined ? cleanLabel : `\x1b]8;;${url}\x1b\\${cleanLabel}\x1b]8;;\x1b\\`
}
