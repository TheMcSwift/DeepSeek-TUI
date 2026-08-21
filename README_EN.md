# DeepSeek-TUI

`dsh --profile tui`: a **terminal chat interface** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). Install one plugin and hold an ongoing conversation with your agent in the terminal — review tool execution, steer mid-turn, queue follow-ups — with the interaction aligned to the official web client, no browser needed.

The headless `dsh` form fits one-shot tasks (submit, run, print the result to stdout); for an ongoing session, use `dsh --profile tui`.

[中文版](README.md) · Feature-alignment baseline: [FEATURE-CHECKLIST.md](FEATURE-CHECKLIST.md) · Choosing between clients: [see below](#choosing-between-dsh-clients)

---

## Highlights

**The same agent as the official web client**: session records, settings, and permission/plan/workflow plugins are all shared — the agent you talk to in the terminal is the one from the web, with no HTTP hop and no feature degradation.

**Aligned feature-by-feature against the web baseline**: a 148-point comparison (≈ 93% coverage); bilingual UI (zh/en): copy reused verbatim and visual colors taken from the web implementation; status-area layout carried over — the terminal experience converges on the web client instead of inventing a separate one.

**Rendering & tool-execution visualization**: streaming Markdown, graded reasoning blocks, syntax highlighting, TeX math, Mermaid diagrams; tool cards with exit codes, highlighted Read cards, grep/glob grouping, web_search citations, `run_code` sub-call trees; produced files get OSC 8 links (Cmd-click to open).

**Install and go — dsh itself untouched**: mounted as a plugin into the `tui` profile, no dsh source changes, no dependency patches; the rendering engine pi (the independent open-source terminal UI library from earendil-works) is embedded as a vendored snapshot — pinned version, controllable upgrades.

**Keyboard-driven**: Tab focus ring + Enter expand/collapse (thinking blocks / tool cards / long messages); Ctrl+Enter interrupts the current turn and sends, Shift+Tab cycles session modes (default / plan / full access); three keymap presets — Claude Code / pi / OpenCode style (`/keymap` to switch); `/model` and `/permission` support enum picking or direct arguments; @ file-reference completion (content auto-attached on send), `$EDITOR` editing for config and the current input, command aliases, OSC 52 copy.

**Session-level panels**: goal / todo / jobs / workflow run tree (full run→member hierarchy); `/status`, `/tokens`, `/cost` session info; `/config` provider management (list / add wizard / `$EDITOR` settings.yaml).

## Installation

**Prerequisites**: a working dsh environment (Node ≥ 22.19, pnpm).

```bash
# Install from npm (recommended)
dsh plugin --profile tui add @mcswift/dsh-tui

# Or develop locally: mount the source (lib/ is the profile's load entry;
# pnpm build after each change)
git clone https://github.com/TheMcSwift/DeepSeek-TUI.git
dsh plugin --profile tui add link:/path/to/DeepSeek-TUI
cd DeepSeek-TUI && pnpm install && pnpm build
```

## Quick start

```
$ dsh --profile tui                     # new session (regular rendering by default)
$ dsh --profile tui --resume <id>       # resume a specific session
$ dsh --profile tui -c                  # resume the most recent session
$ dsh --profile tui                     # default regular: main-screen output stays in terminal scrollback (no in-app scroll/mouse; `[` exports the transcript)
$ dsh --profile tui --fullscreen        # switch back to the alt-screen viewport (the pre-2026-08-20 default: in-app scroll/mouse/search-jump)
```

```
dsh tui — DeepSeek Harness terminal client
Esc/Ctrl+C interrupt (busy) · Ctrl+C press twice to quit (idle) · Ctrl+Enter interrupt & send · `/` slash menu · Ctrl+/ command palette
Ctrl+R sessions · Ctrl+G model · Ctrl+P presets · Ctrl+F search · Ctrl+B fork · Ctrl+Y rate
Ctrl+X edit input in $EDITOR · Ctrl+W workspace · Ctrl+T thinking · Ctrl+K fold · Ctrl+E exit plan
Ctrl+O fold/expand jobs · Ctrl+L trajectory · Alt+Enter steer · Alt+Up retrieve queue · Tab focus ring/follow-up · Enter send (busy=steer)/expand-collapse
```

## Usage

### Commands

| Command | Purpose |
|---|---|
| `/new` `/quit` `/clone` `/hotkeys`(`?`) | session controls |
| `/rename <title>` | pin the session title (overrides auto-generation) |
| `/queue` | list queued messages: retrieve or delete each |
| `/effort` `/lang` `/rate` `/export`(`[md]`) | reasoning effort / language / rate / export session log (`md` = Markdown sections) |
| `/model [provider/model]` | switch model: bare opens the enum picker, with an argument it switches directly |
| `/permission [preset]` | switch permission preset: bare opens the enum picker, with an argument it switches directly (full-access asks first) |
| `/config` | provider list / add-provider wizard / preview & `$EDITOR` settings.yaml |
| `/status` `/tokens` `/cost` `/doctor` `/init` `/agents` `/skills` | status & diagnostics (notice + Enter expands the full text) |
| `/mcp` `/permissions` `/login` `/logout` `/add-dir` `/hooks` `/vim` `/terminal-setup` `/connect` | policy/platform info (dsh capability notes or placeholders) |
| `/resume`(`/r`) `/rewind` `/trajectory` `/settings` `/plugins` `/workspace` `/theme` `/keymap` `/preset` `/compose` | more TUI-native commands (browse via Ctrl+/ palette; `/rewind` forks at a user message and refills the input — double-Esc on an empty input is the same entry) |
| `/goal /plan /compact …` | profile-registered commands |

**Command aliases**: `exit`→`quit` · `clear`→`new` · `?`→`hotkeys` · `r`→`resume` · `m`→`model` · `perm`→`permission` · `language`→`lang` (resolved in the slash chain; the menu still shows the canonical names).

### Environment variables

| Variable | Meaning |
|---|---|
| `DSH_TUI_DEBUG` | `1` emits event/render debug logs |
| `DSH_TUI_ANIM` | `0` freezes brand shimmer and spinner animation |
| `DSH_TUI_THEME` | `light`/`dark`/`auto` (follows the terminal background) |
| `DSH_TUI_THEME_PRESET` | `web`/`cc`/`pi`/`opencode` visual theme preset (same as `/theme`) |
| `DSH_TUI_KEYMAP` | `cc`/`pi`/`opencode` keymap preset (same as `/keymap`) |
| `DSH_TUI_LANG` | `zh`/`en` (`/lang` switches at runtime) |
| `DSH_TUI_ENTER` | `steer`: Enter steers while busy; default `queue` (waits for idle) |
| `DSH_TUI_MOUSE` | `1` enables in-TUI mouse (selection/copy, wheel-scroll the message list); **off by default** — right-click/wheel stay with the host terminal (Warp native menu/scrollback); PgUp/PgDn keyboard scrolling always works |
| `DSH_TUI_REGULAR` | `1` forces regular rendering (main-screen output stays in terminal scrollback; **the default**) — `[` exports the transcript for Cmd+F |
| `DSH_TUI_FULLSCREEN` | `1` switches back to the fullscreen viewport (same as `--fullscreen`, the pre-2026-08-20 default) — in-app scroll/mouse/search-jump |
| `DSH_TUI_WARP_NOTIFY` | `off` disables Warp notifications (OSC 777) |

### Choosing between dsh clients

| Choice | Fits | Notes |
|---|---|---|
| Official web client | browser, rich interactions (images/drag-drop/forms) | the full-featured baseline |
| **This TUI** (in-process) | terminal with the web's stack and data | same sessions/settings/plugins; must run on the machine where dsh is installed |
| Remote HTTP TUIs ([dsh-tui/dsh-tui](https://github.com/dsh-tui/dsh-tui), [MashedPotato817/dsh-tui](https://github.com/MashedPotato817/dsh-tui), …) | reach a remote dsh host from any machine | interaction style of their own, not the web stack; Vim modal editing etc. |

**Our trade-offs**: runs only on the machine where dsh is installed (no remote mode); pi version pinned (0.84.1 vendored snapshot), upstream fixes need manual follow-up; browser abilities (images/drag-drop/settings forms) degrade to terminal shapes — images → placeholder rows, settings page → `/config`; regular rendering by default (output stays in terminal scrollback), in-app search-jump/scrolling unavailable (use the terminal's native Cmd+F), `--fullscreen` switches back to the viewport mode.

## For developers

**Data flow**: `SessionEvent → fold() → ViewDocument → app.render()` one-way; `fold()` is pure (no cordis, no pi), and every new event type gets a regression in `tests/projection.spec.ts`.

**Out-of-tree constraints**: `cordis.patch.yml` is **required** (its absence is a hard error); `insert` rows may only reference plugins already shipped with the dsh install. More in [DESIGN.md](DESIGN.md) §10 and [ARCHITECTURE.md](ARCHITECTURE.md).

```bash
pnpm typecheck        # strict tsc
pnpm test             # vitest units (395)
pnpm build            # tsc build into lib/
python3 scripts/e2e-pty.py           # 9-scenario PTY end-to-end (real dsh + mock LLM)
python3 scripts/e2e-pty.py --only-questions   # one scenario
```

### Docs

| Doc | Content |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | overall structure: module roles, boundaries, dependency direction |
| [DESIGN.md](DESIGN.md) | design contracts & revision history (§10 out-of-tree constraints) |
| [FEATURE-CHECKLIST.md](FEATURE-CHECKLIST.md) | dsh web-alignment baseline (148-point per-package audit) |
| [GAP-ANALYSIS.md](GAP-ANALYSIS.md) · [PI-GAP-ANALYSIS.md](PI-GAP-ANALYSIS.md) | baseline gap audits |
| [INTERACTION-PLAN.md](INTERACTION-PLAN.md) | interaction plan & batches |
| [CONTRIBUTING.md](CONTRIBUTING.md) | contributing (commit trailer conventions) |
| [LICENSE](LICENSE) | MIT |

## Credits

This project was written entirely with dsh and the DeepSeek model: planning, implementation, review, and documentation were all done in [dsh](https://github.com/deepseek-ai/deepseek-harness)-driven deepseek-v4-pro sessions (every commit carries an `Assisted-by: dsh` trailer).

Inspired by: the official web client (feature baseline, copy and design tokens), pi (rendering engine), Claude Code / pi interaction style, and the community [ccch1mneyyy/dsh-TUI](https://github.com/ccch1mneyyy/dsh-TUI) (brand block: DeepSeek pixel whale + gradient DEEPSEEK wordmark + `探索未至之境！`).
