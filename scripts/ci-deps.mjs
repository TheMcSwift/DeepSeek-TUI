#!/usr/bin/env node
/**
 * CI-only: swap the local `link:../deepseek-harness/...` devDependencies for
 * their published npm versions and drop the lockfile so CI installs the
 * released dsh family (published packages ship lib/ + full transitive deps).
 * Local development keeps the link layout untouched — run this script ONLY
 * on CI (see .github/workflows/ci.yml), never in a local workspace.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'

const pkgPath = new URL('../package.json', import.meta.url).pathname
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
const deps = pkg.devDependencies ?? {}
let swapped = 0
for (const [name, spec] of Object.entries(deps)) {
  if (typeof spec !== 'string' || !spec.startsWith('link:')) continue
  const version = execFileSync('npm', ['view', name, 'version'], { encoding: 'utf8' }).trim()
  if (version === '') throw new Error(`npm view ${name} version returned nothing`)
  deps[name] = `^${version}`
  swapped += 1
  console.log(`${name}: link -> ^${version}`)
}
if (swapped === 0) throw new Error('no link: devDependencies found — already swapped?')
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
rmSync(new URL('../pnpm-lock.yaml', import.meta.url), { force: true })
console.log(`swapped ${swapped} link deps; lockfile dropped`)
