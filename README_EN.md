# DeepSeek-TUI

`dsh --profile tui` — the **terminal interactive client** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

It is an **out-of-tree profile bundle**: it rides dsh's shared plugin stack (Agent, tools, MCP, session persistence, permission presets) and adds one full-screen interactive chat layer — no Host, no HTTP, no browser. Run headless tasks with `dsh`; talk to agents with `dsh --profile tui`.

[中文版](README.md) · Feature-alignment baseline: [FEATURE-CHECKLIST.md](FEATURE-CHECKLIST.md)

---

## Quick start

```
$ dsh --profile tui                     # new session
$ dsh --profile tui --resume <id>       # resume a session
$ dsh --profile tui -c                  # resume the most recent session
```

```
dsh tui — DeepSeek Harness terminal client
Esc: interrupt (busy) · Ctrl+C: quit (idle) · `/` slash menu · Ctrl+/ command palette
Ctrl+R sessions · Ctrl+G model · Ctrl+P presets · Ctrl+F search · Ctrl+B fork · Ctrl+Y rate
Ctrl+X copy reply · Ctrl+W workspace · Ctrl+T thinking · Ctrl+K fold · Ctrl+E exit plan
Alt+Enter steer · Alt+Up retrieve queue · Tab focus ring · mouse: row-tail ⏎/▸/▾ icons expand
```

## What it is

A terminal surface for **dsh agent sessions**, aligned feature-by-feature against the dsh **web client** baseline (see FEATURE-CHECKLIST.md, 148 points, ≈ 92% coverage):

- **Streaming rendering**: incremental Markdown, graded reasoning blocks, syntax highlighting, TeX math, Mermaid diagrams
- **Tool execution**: terminal cards (exit-code pill), Read cards, grep/glob grouping, web_search citations, `run_code` recursive sub-call trees, produced-file OSC 8 links
- **Complete interactions**: slash menu / command palette, multi-select question forms, approval dialogs, fork, message rating, full-text search, session search
- **Session panels**: goal / todo / jobs / **workflow run tree** (run→member disclosure)
- **Fixed status areas** (web layout semantics): above the input line = running state + permission preset; below = session stats strip + model/ctx pressure/cwd/token counts
- **Mouse support**: wheel scrolling, small row-tail icons to expand (⏎ folded messages/tool cards, ▸/▾ thinking blocks)
- **Bilingual UI**: complete zh/en dictionaries (copy reused verbatim from the web locale tables), switchable via `/lang` or `DSH_TUI_LANG`
- **Theming**: dark/light palettes (design tokens taken verbatim from the web `design-platform.css` + shiki colors)

## Architecture

Layered, one-way data flow; the document is the source of truth:

```
src/
├── control/        # approval waterfall, userQuestions provider, session/model sources
├── document/       # ViewDocument contract: entry types + lifecycle + plain transcript
├── projection/     # fold: SessionEvent → ViewDocument (incremental, immutable updates)
│   ├── stats.ts    #   session stats (the web StatsLine fold math)
│   └── synthesis/  #   DSH blocks → pi-ai shapes, tool definition registry
├── app/            # PiTuiApp: layout / focus ring / overlays / click hit-testing (TuiAltScreen instance hooks)
│   └── pi/         #   themes / palettes / highlighting
├── view/           # components: messages / tool cards / panels / menus / dialogs / brand + strings
├── index.ts        # runner: boot/resume, event folding, command dispatch, quit/flush
└── startup.ts      # profile entry (dsh-tui-app/startup row)
```

**Data flow**: `session/event` → `fold()` → `ViewDocument` → `app.render()` → differential repaint. Folding is pure (no cordis, no pi); `tests/projection.spec.ts` regresses every event.

**dsh integration**: this repository is an out-of-tree profile (`cordis.patch.yml` declares the startup/runner rows plus persona/hmr/tools overrides), mounted with `dsh plugin --profile tui add link:<this repo>`; at runtime it structurally reads the host composition's services (`commands`/`skills`/`sessionQuery`/`sessionTitle`/`jobs`/`userQuestions`) through `ctx.get(...)`.

## What it borrows

| Source | Borrowed |
|---|---|
| **dsh web client** (`packages/client/ui-*`) | feature checklist and interaction semantics (per-package audit in FEATURE-CHECKLIST.md), design tokens (`design-platform.css`/shiki palette), locale copy (verbatim), StatsLine semantics, composer.dock status-area layout |
| **pi-tui** (`@earendil-works/pi-tui`, Claude Code's renderer) | rendering engine (TuiAltScreen viewport mode), Editor/Markdown/ScrollView components, keyboard-protocol negotiation, overlay mechanism |
| **Claude Code / pi interaction style** | Esc interrupt, non-blocking decision cards (number picks), inline slash menu, bottom-anchored composer, tool-card expansion |
| **community dsh-TUI** (github.com/ccch1mneyyy/dsh-TUI) | brand block: DeepSeek pixel whale + gradient DEEPSEEK wordmark + `探索未至之境！` |

## Installation

**Prerequisites**: a working dsh environment (Node ≥ 20, pnpm) and a clone of this repository.

```bash
# 1. Mount this package as dsh's tui profile plugin
DSH_HOME=~/.dsh dsh plugin --profile tui add link:/path/to/DeepSeek-TUI

# 2. Build for development (lib/ is the profile's load entry)
pnpm install
pnpm build
```

> The out-of-tree profile's `cordis.patch.yml` is **required** (its absence is a hard error); `insert` rows may only reference plugins already shipped with the dsh install. More constraints in DESIGN.md §10.

## Usage

### Commands

| Command | Purpose |
|---|---|
| `/new` `/quit` `/clone` `/help`(`/hotkeys`) | session controls |
| `/rename <title>` | pin the session title (overrides auto-generation) |
| `/queue` | list queued messages: retrieve or delete each |
| `/effort` `/lang` `/rate` `/export` | reasoning effort / language / rate / export session log |
| `/goal /plan /compact /permission …` | profile-registered commands (browse via Ctrl+/ palette) |

### Environment variables

| Variable | Meaning |
|---|---|
| `DSH_TUI_DEBUG` | `1` emits event/render debug logs |
| `DSH_TUI_ANIM` | `0` freezes brand shimmer and spinner animation |
| `DSH_TUI_THEME` | `light`/`dark`/`auto` (OSC 11 detection) |
| `DSH_TUI_LANG` | `zh`/`en` (`/lang` switches at runtime) |
| `DSH_TUI_ENTER` | `steer` makes busy-Enter steer (default: queue) |
| `DSH_TUI_MOUSE` | `0` disables mouse capture (restores host terminal right-click/wheel) |

## Development & testing

```bash
pnpm typecheck        # strict tsc
pnpm test             # vitest units (220: projection/runner/views/themes/panels)
pnpm build            # tsc build into lib/
python3 scripts/e2e-pty.py           # 6-scenario PTY end-to-end (core/resume/approval/questions/interactions)
python3 scripts/e2e-pty.py --only-questions   # one scenario
```

Docs: [ARCHITECTURE.md](ARCHITECTURE.md) structure · [DESIGN.md](DESIGN.md) contracts & revisions · [FEATURE-CHECKLIST.md](FEATURE-CHECKLIST.md) web-alignment baseline · [GAP-ANALYSIS.md](GAP-ANALYSIS.md) / [PI-GAP-ANALYSIS.md](PI-GAP-ANALYSIS.md) baseline audits · [INTERACTION-PLAN.md](INTERACTION-PLAN.md) interaction plan.

---

This project is developed **with the assistance of dsh (DeepSeek Harness)**: session-driven feature alignment, review and regression loops all run inside `dsh --profile tui` itself; commits carry the `🤖 Generated with dsh (DeepSeek Harness)` marker.
