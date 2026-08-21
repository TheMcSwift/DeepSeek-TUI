/**
 * The TUI app's command-line provider over a real Loader tree: parsed flags
 * become injected runner config, while help and usage errors leave the
 * consumer pending — mirroring the headless startup contract.
 */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { internals, provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, TUI_STARTUP_SERVICE, type TuiStartupValues } from '../src/startup.ts'

interface Observed {
  exits: number[]
  out: string
  runnerConfig?: unknown
}

const disposers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
  internals.stdout = process.stdout
  internals.stderr = process.stderr
})

async function bootStartup(args: string[]): Promise<{ values: TuiStartupValues | undefined; observed: Observed }> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tui-startup-'))
  const observed: Observed = { exits: [], out: '' }
  writeFileSync(join(dir, 'row.mjs'), 'export function apply(_ctx, config) { globalThis.__tuiStartupObserved.runnerConfig = config }\n')
  writeFileSync(join(dir, 'startup.mjs'), `
export const name = 'tui-startup'
export const inject = ['cmdlineArgs']
export const apply = ctx => globalThis.__tuiStartupApply(ctx)
`)
  const rowUrl = pathToFileURL(join(dir, 'row.mjs')).href
  writeFileSync(join(dir, 'cordis.yml'), [
    '- id: tui-runner',
    `  name: ${rowUrl}`,
    `  inject: [${TUI_STARTUP_SERVICE}]`,
    '  config:',
    '    resume: !!js ctx.tuiStartup.resume',
    '    model: !!js ctx.tuiStartup.model',
    '    workspace: !!js ctx.tuiStartup.workspace',
    '    browse: !!js ctx.tuiStartup.browse',
    '    noSession: !!js ctx.tuiStartup.noSession',
    '    regular: !!js ctx.tuiStartup.regular',
    '- id: tui-startup',
    `  name: ${pathToFileURL(join(dir, 'startup.mjs')).href}`,
    '',
  ].join('\n'))
  const observing = { write: (chunk: string) => { observed.out += chunk; return true } }
  internals.stdout = observing
  internals.stderr = observing
  const globals = globalThis as unknown as {
    __tuiStartupApply: typeof apply
    __tuiStartupObserved: Observed
  }
  globals.__tuiStartupApply = apply
  globals.__tuiStartupObserved = observed

  const ctx = new Context()
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  provideCmdline(ctx, { args, exit: code => void observed.exits.push(code) })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(dir, 'cordis.yml')).href } })
  await ctx.loader.await()
  disposers.push(async () => { await ctx.fiber.dispose() })
  return {
    values: ctx.get(TUI_STARTUP_SERVICE) as TuiStartupValues | undefined,
    observed,
  }
}

describe('tui command-line provider', () => {
  it('maps the optional flags into runner config', async () => {
    const { values, observed } = await bootStartup(['--resume', 'abc123', '--model', 'pi-ai/deepseek-v4', '--workspace', '/tmp/ws'])
    expect(values).toEqual({ resume: 'abc123', model: 'pi-ai/deepseek-v4', workspace: '/tmp/ws' })
    expect(observed.runnerConfig).toEqual({ resume: 'abc123', model: 'pi-ai/deepseek-v4', workspace: '/tmp/ws' })
    expect(observed.exits).toEqual([])
  })

  it('maps -c/-r/--no-session into the runner config (T5⑦)', async () => {
    const { values, observed } = await bootStartup(['-c', '-r', '--no-session'])
    expect(values).toEqual({ resume: '__latest__', browse: true, noSession: true })
    expect(observed.runnerConfig).toEqual({ resume: '__latest__', browse: true, noSession: true })
  })

  it('maps --regular into the runner config', async () => {
    const { values, observed } = await bootStartup(['--regular'])
    expect(values).toEqual({ regular: true })
    expect(observed.runnerConfig).toEqual({ regular: true })
  })

  it('maps --fullscreen into the runner config (regular: false)', async () => {
    const { values, observed } = await bootStartup(['--fullscreen'])
    expect(values).toEqual({ regular: false })
    expect(observed.runnerConfig).toEqual({ regular: false })
  })

  it('runs with no flags at all (fresh interactive session)', async () => {
    const { values, observed } = await bootStartup([])
    expect(values).toEqual({})
    expect(observed.runnerConfig).toEqual({})
    expect(observed.exits).toEqual([])
  })

  it('prints its own help and leaves the runner pending', async () => {
    const { values, observed } = await bootStartup(['--help'])
    expect(observed.out).toContain('dsh --profile tui')
    expect(values).toBeUndefined()
    expect(observed.runnerConfig).toBeUndefined()
    expect(observed.exits).toEqual([0])
  })

  it('rejects an unknown option as a usage error', async () => {
    const { values, observed } = await bootStartup(['--bogus'])
    expect(observed.out).toContain('unknown option')
    expect(values).toBeUndefined()
    expect(observed.runnerConfig).toBeUndefined()
    expect(observed.exits).toEqual([1])
  })
})
