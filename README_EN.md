# DeepSeek-TUI

`dsh --profile tui` — the **terminal interactive client** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

> **This tool was written entirely with dsh and the DeepSeek model**: every line of code and documentation was planned, implemented, reviewed, and written in [dsh](https://github.com/deepseek-ai/deepseek-harness)-driven deepseek-v4-pro sessions (commits carry an `Assisted-by: dsh` trailer); the repository is itself the dsh agent's working field.
>
> **The TUI engine is [pi](https://github.com/pi-ai-oss/pi)** (pi-tui / pi-ai, the renderer behind Claude Code): pi components are vendored verbatim (MIT, see `src/view/pi-vendor/`) and mounted onto pi's TuiAltScreen viewport mode through instance-level hooks — no fork, no node_modules patches.

It is an **out-of-tree profile bundle**: it rides dsh's shared plugin stack (Agent, tools, MCP, session persistence, permission presets) and adds one full-screen interactive chat layer — no Host, no HTTP, no browser. Run headless tasks with `dsh`; talk to agents with `dsh --profile tui`.

[中文版](README.md) · Feature-alignment baseline: [FEATURE-CHECKLIST.md](FEATURE-CHECKLIST.md) · Community comparison: [vs. other dsh TUIs](#vs-other-community-dsh-tuis)

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
Alt+Enter steer · Alt+Up retrieve queue · Tab focus ring · Enter expand/collapse (thinking/tool cards/long messages)
```

## What it is

A terminal surface for **dsh agent sessions**, aligned feature-by-feature against the dsh **web client** baseline (see FEATURE-CHECKLIST.md, 148 points, ≈ 92% coverage):

- **Streaming rendering**: incremental Markdown, graded reasoning blocks, syntax highlighting, TeX math, Mermaid diagrams
- **Tool execution**: terminal cards (exit-code pill), Read cards, grep/glob grouping, web_search citations, `run_code` recursive sub-call trees, produced-file OSC 8 links
- **Complete interactions**: slash menu (with command aliases) / command palette, multi-select question forms, approval dialogs, fork, message rating, full-text search, session search
- **Session panels**: goal / todo / jobs / **workflow run tree** (run→member disclosure)
- **Model & permission switching**: `/model` and `/permission` both support **enum picking** (slash menu / Ctrl+G / Ctrl+P) and **direct arguments** (`/model pi-ai/deepseek-v4`, `/permission workspace-write`); `/config` manages providers (list / add wizard / $EDITOR settings.yaml)
- **Plugin projection awareness**: any plugin registering a select-shaped session projection (like the permission presets) automatically gains an idle chip and the Ctrl+P enum interaction — no TUI change needed
- **Fixed status areas** (web layout semantics): above the input line = running state + plugin projections (permission preset); below = session stats strip + model/ctx pressure/cwd/token counts
- **Keyboard expand/collapse (pi-style)**: Tab focus ring + Enter toggles (thinking blocks / tool cards / folded long messages); the ▸/▾/⏎ icons are pure status markers — no mouse-click listening; wheel scrolling remains
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
├── app/            # PiTuiApp: layout / focus ring / overlays / key routing (TuiAltScreen instance hooks)
│   └── pi/         #   themes / palettes / highlighting
├── view/           # components: messages / tool cards / panels / menus / dialogs / brand + strings
├── index.ts        # runner: boot/resume, event folding, command dispatch, quit/flush
└── startup.ts      # profile entry (`@mcswift/dsh-tui/startup` row)
```

**Data flow**: `session/event` → `fold()` → `ViewDocument` → `app.render()` → differential repaint. Folding is pure (no cordis, no pi); `tests/projection.spec.ts` regresses every event.

**dsh integration**: this repository is an out-of-tree profile (`cordis.patch.yml` declares the startup/runner rows plus persona/hmr/tools overrides), mounted with `dsh plugin --profile tui add @mcswift/dsh-tui` (or `add link:<this repo>` for local development); at runtime it structurally reads the host composition's services (`commands`/`skills`/`sessionQuery`/`sessionTitle`/`jobs`/`userQuestions`/`settings`/`sessionProjections`) through `ctx.get(...)`.

## vs. other community dsh TUIs

| Project | Shape | Differences from us |
|---|---|---|
| [dsh-tui/dsh-tui](https://github.com/dsh-tui/dsh-tui) | out-of-tree bundle + pi-tui (pnpm patches over pi-tui) | Same pi-tui bundle family. It patches pi-tui, uses Ctrl+O three-level tool cards, and a persistent todo panel; we **never patch pi** (vendor + instance hooks), tool cards toggle with Enter + `i` raw input, and status areas / i18n / command surface stay closer to the web layout semantics |
| [MashedPotato817/dsh-tui](https://github.com/MashedPotato817/dsh-tui) | **remote client** over the DSH HTTP contract (Claude Code style + Vim modal input + HUD) | It is an HTTP client that can reach a dsh host from any machine; we are an **in-process profile** sharing the web's plugin stack and session semantics (no HTTP hop, no feature degradation), but must run on the machine where dsh is installed |
| `dsh-claude-tui` (npm) | Claude Code-style remote TUI | interaction style first; we baseline against the web client (148-point checklist) |
| `@xmoon76/dsh-pi-tui` and other npm pi-tui builds | pi-tui clients | same engine family, independent implementations; see each project's README |
| dsh official web client | browser | we align to the web interaction and copy feature-by-feature, but are not a replacement — terminals lack browser abilities (images, drag & drop, rich cards) |

**Our strengths**

- Shares the web's plugin stack and persistence: the same session jsonl, the same settings.yaml, the same permission/plan/workflow plugins — zero semantic drift
- Measurable alignment: a 148-point per-package audit (FEATURE-CHECKLIST.md), bilingual copy reused verbatim from the web locale tables
- Never patches pi-tui: vendored snapshot + instance-level hooks — pi upgrades stay controllable, no patch rot
- Native terminal abilities: PTY-driven, OSC 8 file links, OSC 52 clipboard copy, `$EDITOR` suspend-and-edit config, command aliases

**Our trade-offs**

- Runs only on the machine where dsh is installed (no HTTP remote mode); use the HTTP clients for remote sessions
- pi version pinned (0.84.1 vendored snapshot); upstream fixes need manual follow-up
- Browser abilities degrade to terminal shapes: the settings page → `/config`, images → placeholder rows
- No Vim modal editing (that is the HTTP clients' niche)

## What it borrows

| Source | Borrowed |
|---|---|
| **dsh web client** (`packages/client/ui-*`) | feature checklist and interaction semantics (per-package audit in FEATURE-CHECKLIST.md), design tokens (`design-platform.css`/shiki palette), locale copy (verbatim), StatsLine semantics, composer.dock status-area layout |
| **pi** (pi-tui / pi-ai, Claude Code's renderer) | rendering engine (TuiAltScreen viewport mode), Editor/Markdown/ScrollView components, keyboard-protocol negotiation, overlay mechanism, keyboard expand/collapse interaction style |
| **Claude Code / pi interaction style** | Esc interrupt, non-blocking decision cards (number picks), inline slash menu, bottom-anchored composer, tool-card expansion |
| **community dsh-TUI** (github.com/ccch1mneyyy/dsh-TUI) | brand block: DeepSeek pixel whale + gradient DEEPSEEK wordmark + `探索未至之境！` |

## Installation

**Prerequisites**: a working dsh environment (Node ≥ 20, pnpm).

```bash
# Install from npm (recommended)
dsh plugin --profile tui add @mcswift/dsh-tui

# Or develop locally: mount the source (lib/ is the profile's load entry;
# pnpm build after each change)
git clone https://github.com/TheMcSwift/DeepSeek-TUI.git
dsh plugin --profile tui add link:/path/to/DeepSeek-TUI
cd DeepSeek-TUI && pnpm install && pnpm build
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
| `/model [provider/model]` | switch model: bare opens the enum picker, with an argument it switches directly |
| `/permission [preset]` | switch permission preset: bare opens the enum picker, with an argument it switches directly (full-access asks first) |
| `/config` | provider list / add-provider wizard / preview & `$EDITOR` settings.yaml |
| `/goal /plan /compact …` | profile-registered commands (browse via Ctrl+/ palette) |

**Command aliases**: `exit`→`quit` · `clear`→`new` · `?`→`hotkeys` · `m`→`model` · `perm`→`permission` · `language`→`lang` (resolved in the slash chain; the menu still shows the canonical names).

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
pnpm test             # vitest units (245: projection/runner/views/themes/panels)
pnpm build            # tsc build into lib/
python3 scripts/e2e-pty.py           # 6-scenario PTY end-to-end (core/resume/approval/questions/interactions)
python3 scripts/e2e-pty.py --only-questions   # one scenario
```

## Docs

| Doc | Content |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | overall structure: module roles, boundaries, dependency direction |
| [DESIGN.md](DESIGN.md) | design contracts & revision history (§10 out-of-tree constraints) |
| [FEATURE-CHECKLIST.md](FEATURE-CHECKLIST.md) | dsh web-alignment baseline (148-point per-package audit) |
| [GAP-ANALYSIS.md](GAP-ANALYSIS.md) · [PI-GAP-ANALYSIS.md](PI-GAP-ANALYSIS.md) | baseline gap audits |
| [INTERACTION-PLAN.md](INTERACTION-PLAN.md) | interaction plan & batches |
| [CONTRIBUTING.md](CONTRIBUTING.md) | contributing (commit trailer conventions) |
| [LICENSE](LICENSE) | MIT |
