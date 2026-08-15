# dsh-tui-app

`dsh --profile tui` — a [pi-tui](https://github.com/earendil-works/pi) terminal surface for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). It is an
out-of-tree profile bundle: it rides the shared `dsh-base` plugin stack (Agent, tools, MCP,
persistence, presets) and adds a full-screen interactive chat — no Host, HTTP, or browser layer.

```
dsh tui — DeepSeek Harness terminal surface
Esc: interrupt (busy) · Ctrl+C: quit (idle) · `/` or Ctrl+/: commands (anchored above the composer)
Ctrl+R: sessions · Ctrl+G: model · Ctrl+P: presets · Ctrl+F: search · Ctrl+B: fork
Ctrl+Y: rate · Ctrl+X: copy reply · Ctrl+W: workspace · Ctrl+T: thinking · Ctrl+K: fold
Ctrl+E: exit plan · Ctrl+D: quit · Alt+Enter: steer · Alt+Up: retrieve queued
```

## Features

- Multi-turn agent chat with **streaming Markdown** replies (reducer-driven, differential rendering)
- Visible **tool-call status** for the current turn (running / done / error)
- **Session persistence** through the shared JSONL backend; `--resume <id>` continues a session
- **Session picker** (Ctrl+R) over `dsh-session-query`, listing persisted sessions with titles;
  type to filter, `●` marks the current session
- **Model picker** (Ctrl+G) over the LLM adapter directory; the choice persists as the default
- **Permission preset switcher** (Ctrl+P) over `permissionPresets` (sandbox + approval bundle);
  the effective preset is marked and the pick applies live to the session
- **`/new`** starts a fresh session in place; **`/quit`** leaves
- **Plan mode**: a `◐ plan` header badge while active; the plan-review question renders the
  plan as Markdown (capped at 12 lines in the dialog)
- **Long messages** fold after 40 lines (`… N more lines`); Tab + Enter expands them like tool cards
- **`read_image` results** show an image placeholder line (no inline terminal images)
- **Composer history** persists to `$DSH_HOME/tui-history.json`; Up/Down recalls (deduped, 200 lines)
- **Big pastes** (30+ lines) ask for confirmation before sending
- **Quiet transcript** (P0–P3 noise discipline): turn outcomes (`已中断`, token ceiling, errors)
  badge the reply they belong to instead of floating as rows; consecutive system notices of the
  same kind (title/preset/plan) converge into one `×N` row; command/effort/copy/rate feedback
  flashes as a 2.5s status-slot toast (errors and auditable facts still persist as rows); several
  background jobs collapse to `◆ jobs ×N · Ctrl+O 展开`
- **Session stats strip** (web StatsLine parity, `src/projection/stats.ts`): the idle status slot
  carries the same bottom strip as the web — `48 轮 · 1749 步 | LLM 340m42s · 工具调用 175m17s |
  首 token 平均 2.9s · 82 tok/s | 缓存命中 100% | 输入 677M tok · 输出 12K tok` — same fold math
  (summed wall times, averaged TTFT, decode throughput), same compact `K/M` + `m/s` units, same
  "group with no data drops out whole" semantics, cache-hit share from the harness's
  `cacheReadTokens/cacheWriteTokens` usage buckets
- **Busy status** shows the elapsed time; the `Deep diving...` line renders in the web-brand
  gradient (`deepseek-450 → deepseek-300`) and shimmers while the turn runs (it rides the
  spinner's 80ms repaint loop — zero extra timers); text typed mid-turn is auto-submitted when it ends
- **Contextual footer** (`ctx N%` from the adapter's context window; interrupt/card/selector hints)
- **`DSH_TUI_THEME=light`** picks the light palette at startup (default: dark)
- **DeepSeek brand splash** (`src/view/brand.ts`, adapted from the dsh-TUI community
  project): on a fresh session the transcript opens with the DeepSeek pixel whale beside a
  5-row gradient `DEEPSEEK` wordmark and the slogan `探索未至之境！` / `Explore the uncharted!`;
  a ~3.4s opening shimmer (moving highlight sweep, web-style) plays once, then the static
  gradient settles; the splash hugs the composer thanks to the bottom anchor and scrolls away
  once the conversation starts. `DSH_TUI_ANIM=0` freezes all animations
- **Slash-command palette** (Ctrl+/): every command the profile registers (`/goal /plan /compact
  /permission /model /feedback …`) plus a native `/export` that flushes the session and reveals
  its jsonl path; commands with input prompts open a free-text dialog
- **Message stats footer**: wall time, first-token latency, decode throughput, and an HH:MM clock
  under each reply; user messages carry the clock too; tool cards show their wall time
- **Every transcript row is keyboard-focusable** (Tab walks newest→oldest, Esc returns): the
  focused frame doubles as the search-jump highlight; `Ctrl+Y` or `/rate` rates the focused reply
- **Footer-first live facts** (pi/cc style): the model, `ctx N%` pressure bar (tiered
  text→warning(60%)→error(80%)), cwd, and token counters live at the bottom; the header keeps
  the session identity only
- **Independent model & effort**: Ctrl+G picks the model (the current effort is kept);
  `/effort` switches the reasoning effort separately
- **Bottom-anchored transcript**: short conversations hug the composer; long ones scroll
  as before
- **`!command` / `!!command`**: run a shell command and send its output to the model (or
  silently); **Alt+Enter** steers the composer into the running turn; **Esc** (busy) interrupts
  the turn (Claude Code style); **Alt+Up** retrieves queued messages back to the editor
- **Mouse**: capture is off by default so the host terminal's right-click menu and selection
  keep working (Warp panels); `DSH_TUI_MOUSE=1` re-enables wheel scrolling and in-TUI selection
- **Language**: `DSH_TUI_LANG=zh|en` picks the dictionary at startup (default zh); `/lang` switches
  live. The copy reuses the dsh web client's zh/en locale tables
- **Theme**: `DSH_TUI_THEME=light|dark` picks a palette; `=auto` probes the terminal background
  (OSC 11, best-effort, dark fallback — opt-in because probing stdin before the TUI owns the
  terminal races the raw-mode handover). Both palettes reuse the dsh web's exact theme colors
  (`--dsw-*` design tokens from packages/client/ui-theme)
- **Graded thinking**: reasoning blocks render at three descending intensities
- **Mermaid diagrams** render as Unicode terminal box art once a reply settles
- **Ctrl+X** copies the latest reply (OSC 52); `/hotkeys` lists every shortcut
- **CLI**: `-c/--continue` resumes the most recent session, `-r/--browse` opens the picker at
  boot, `--no-session` skips persistence, plus `/clone` duplicates the current session
- **Produced files**: the assistant stats line lists the turn's written files (`✎ a.txt, b.txt`)
  gathered from the turn's tool diffs
- **Injected context rows**: skill catalogs, goal rounds, and workspace instructions render as
  compact system rows instead of being dropped
- **Message queue**: Enter during a busy turn queues up to 10 messages and drains them FIFO at
  each turn end (web Enter-as-Queue semantics); the status slot shows the queue length
- **Background jobs** (subagent one-shots) render live in the capability panel
- **Session picker indents subagent children** under their parent session
- **Plan mode**: `Ctrl+E` leaves plan mode; the review dialog marks the approve option with ✔
- **Transcript search** (Ctrl+F): query → match list with previews → Enter jumps the scroll to the
  entry (and focuses it when keyboard-reachable)
- **Message fork** (Ctrl+B): pick a user message and fork a new session seeded through its turn
  (the web's branch action; `parentSession` lineage is recorded)
- **Reply feedback**: `/rate` in the palette rates the latest reply 👍/👎 with an optional note,
  persisted to `$DSH_HOME/tui-feedback.json` (the service-backed web store needs storage plugins an
  out-of-tree profile cannot mount); rated sessions replay with a summary row
- **Reasoning effort**: picking a model whose adapter advertises efforts opens a second dialog;
  the choice rides `ModelSelection.reasoningEffort`
- **Workspace switch** (Ctrl+W): enter a directory and a fresh session starts there
- **Subagent descriptor** and **feedback record** events render as system rows
- **Interrupt** the current turn (Esc while busy) through agent cancellation
- Clean terminal restore on quit, SIGINT, and SIGTERM; explicit error outside a TTY

## Install

Requires a working `dsh` installation (Node ≥ 22.19). From this checkout:

```sh
pnpm install && pnpm build
dsh plugin --profile tui add link:/absolute/path/to/DeepSeek-TUI
dsh --profile tui
```

`dsh plugin` initializes the profile, links this package, and reconciles `dsh.profile.bundles`
(which becomes `@deepseek-ai/dsh-base` + `dsh-tui-app`). The package's `@deepseek-ai/*` peers
resolve from the installation-maintained fallback at `$DSH_HOME/profiles/node_modules`.

## Usage

```sh
dsh --profile tui                      # fresh interactive session
dsh --profile tui --resume abc123      # continue the persisted session abc123
dsh --profile tui --model pi-ai/deepseek-v4
dsh --profile tui --workspace /path/to/project
dsh --profile tui --help               # this app's flags (not the launcher's)
```

Keys: `Esc` interrupt (busy) · `Ctrl+C` quit (idle) · `Ctrl+/` commands · `Ctrl+R` sessions · `Ctrl+G` model · `Ctrl+P`
presets · `Ctrl+F` search · `Ctrl+B` fork · `Ctrl+Y` rate focused reply · `Ctrl+W` workspace ·
`Ctrl+T` thinking · `Ctrl+K` fold/unfold · `Ctrl+O` expand jobs · `Ctrl+E` leave plan mode · `Ctrl+D` quit ·
`/new`, `/quit`, `/rate` in the palette · `PgUp`/`PgDn`/wheel scroll · `Tab`/`Esc` walk every
message/card focus, Enter expands.
Enter submits (queued while busy), Shift+Enter inserts a newline, Up/Down recalls history.

## Rendering

The surface composes pi's own interactive-mode look on the alternate screen buffer
(terminal scrollback stays intact):

- **Alt-screen TUI** (`TuiAltScreen`) with pi's layout engine: the transcript lives in a
  primary `ScrollView` (follow-end, transient scrollbar) with native PageUp/PageDown/wheel
  scrolling;
- **dsh web palette** (`src/app/pi/palette.ts`, every hex a verbatim `--dsw-*` / `--shiki-*`
  token from `packages/client/ui-theme`): user messages on the web's bubble background,
  assistant messages on the transparent background, tool cards colored by lifecycle state,
  OSC 133 zones around every message;
- **code highlighting** via highlight.js restyled through the palette
  (`src/app/pi/highlight.ts`, vendored from pi's `syntax-highlight.ts`);
- **working status slot**: animated loader while a turn runs, fixed-height idle spacer
  (pi's IdleStatus pattern) so the layout never jumps;
- **DSH-specific renderers**: goal/todo panel, approval records + question dialog (both the
  `approval/request` waterfall and the `userQuestions` provider), all fail-closed;
- **live footer**: workspace, message count, and token usage summed from the session log;
- **composer autocomplete**: slash commands and file paths;
- **injected context stays off-screen**: the harness appends workspace instructions and
  runtime snapshots as non-`user`-sourced messages; the reducer renders only
  `source.kind === 'user'`;
- **incremental views**: message views are reconciled by stable key (append-only), the
  streaming message updates in place, and `reset()` drops everything on session swap.

### Vendored from earendil-works/pi (MIT License)

| This repo | source |
|---|---|
| `src/app/pi/palette.ts` | dsh web design tokens (`packages/client/ui-theme/src/styles/design-platform.css` + `shiki.css`) |
| `src/app/pi/highlight.ts` | `packages/coding-agent/src/utils/syntax-highlight.ts` + `html.ts` |
| `src/app/pi/truncate.ts` | `.../components/visual-truncate.ts` |
| `src/app/pi/dynamic-border.ts` | `.../components/dynamic-border.ts` |
| `src/app/pi/message-view.ts` | `.../components/user-message.ts` + `assistant-message.ts` |
| `src/app/pi/tool-panel.ts` | `.../components/tool-execution.ts` |
| status slot / idle spacer | `.../components/status-indicator.ts` pattern |

pi's published `@earendil-works/pi-coding-agent` exports these components, but importing
the barrel drags in native/wasm and settings machinery, so the small self-contained parts
are vendored with attribution instead.

## Architecture

```
dsh launcher (untouched)
└── profile tui: dsh-base + dsh-tui-app (this package)
    ├── tui-startup  — commander flags → tuiStartup service (src/startup.ts)
    └── tui-runner   — Agent create/resume, session-event → view folding, lifetime (src/index.ts)
        ├── app/state.ts        — pure reducer: SessionEvent → ChatState (unit-tested)
        ├── app/terminal-app.ts — the surface seam (fake-substitutable)
        └── app/pi-tui-app.ts   — pi-tui implementation (headless-testable via internals)
```

The runner mirrors `dsh-headless`: it creates an Agent through the core registry
(`agents.create` / `agents.resume`), subscribes to `session/event`, and flushes the session
before exit.

## Development

```sh
pnpm install          # dev deps link to a deepseek-harness checkout (see package.json)
pnpm test             # vitest: reducer, runner, startup, headless pi-tui surface
pnpm typecheck && pnpm build
```

Live loop (the profile links this directory, so rebuilds are picked up directly):

```sh
dsh --profile tui
```

Mock-LLM end-to-end (no provider key):

```sh
# in the harness checkout:
node --import tsx/esm packages/test-support/llm-mock-server/src/bin.ts --port 8765 --api-key mock-key --sequence success --repeat-last
# then:
DEEPSEEK_BASE_URL=http://127.0.0.1:8765/v1 DEEPSEEK_API_KEY=mock-key dsh --profile tui
```

## License

MIT
