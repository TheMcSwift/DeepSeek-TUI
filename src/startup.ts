/**
 * The TUI app's command-line provider: parses the optional `--resume`,
 * `--model`, and `--workspace` flags plus `--help`, then publishes
 * {@link TUI_STARTUP_SERVICE}. The runner is an ordinary consumer whose lazy
 * config waits for that service.
 * @module dsh-tui-app/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Services required before the flags can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the TUI runner. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** What the runner row reads from {@link TUI_STARTUP_SERVICE}. */
export interface TuiStartupValues {
  /** Persisted session id to resume, when given (`__latest__` for -c). */
  resume?: string
  /** Model override as `provider/model`, when given. */
  model?: string
  /** Working directory for the new agent, when given. */
  workspace?: string
  /** -r: open the session picker right after boot. */
  browse?: boolean
  /** --no-session: skip persisting this run's session on quit. */
  noSession?: boolean
}

/**
 * This app's command: the optional flags and their help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function tuiCommand(): Command {
  return new Command()
    .name('dsh --profile tui')
    .description('Open the interactive terminal surface over a dsh agent.')
    .helpOption('-h, --help', 'show this help')
    .option('--resume <session>', 'resume the persisted session with this id')
    .option('-c, --continue', 'continue the most recent session (pi parity)')
    .option('-r, --browse', 'open the session picker right after boot')
    .option('--no-session', 'do not persist this run')
    .option('--model <provider/model>', 'override the default model for this session')
    .option('--workspace <dir>', 'working directory for the agent (default: the invoking directory)')
    .addHelpText('after', `
Examples:
  dsh --profile tui                      start a fresh interactive session
  dsh --profile tui --resume abc123      continue the persisted session abc123
  dsh --profile tui -c                   continue the most recent session
  dsh --profile tui -r                   boot, then browse sessions
  dsh --profile tui --model pi-ai/deepseek-v4
`)
}

/**
 * Parse and provide the optional invocation flags as an ordinary Cordis
 * service. The command's action publishes the values; on `--help` or a usage
 * error nothing is provided and the runner stays pending.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action(() => {
    // commander renders `--no-session` as the negated boolean `session`.
    const options = program.opts<{ resume?: string; model?: string; workspace?: string; browse?: boolean; session?: boolean; continue?: boolean }>()
    ctx.provide(TUI_STARTUP_SERVICE, {
      ...options.resume === undefined ? {} : { resume: options.resume },
      ...options.continue === true ? { resume: '__latest__' } : {},
      ...options.model === undefined ? {} : { model: options.model },
      ...options.workspace === undefined ? {} : { workspace: options.workspace },
      ...options.browse === true ? { browse: true } : {},
      ...options.session === false ? { noSession: true } : {},
    } satisfies TuiStartupValues)
  })
  parseCmdline(ctx, program)
}
