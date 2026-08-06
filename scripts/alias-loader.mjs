// Resolves the app's `@/…` path alias and TS-style extensionless relative
// imports, so the check scripts can import modules that live behind them.
// Without this, anything importing `@/lib/…` — including `hooks/use-coolify.ts`,
// where the deploy verdict's only judge lives — is unreachable from Node and
// therefore untestable.
//
// An async loader on purpose: the synchronous `registerHooks` equivalent breaks
// Node's CJS named-export detection for `react`, which these modules import.
import { pathToFileURL, fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync, statSync } from 'node:fs'

const WEB = join(import.meta.dirname, '..', 'apps', 'web')

function firstExisting(base) {
  for (const candidate of [`${base}.ts`, `${base}.tsx`, base, join(base, 'index.ts')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

export function resolve(specifier, context, nextResolve) {
  let hit = null
  if (specifier.startsWith('@/')) {
    hit = firstExisting(join(WEB, specifier.slice(2)))
  } else if (
    (specifier.startsWith('./') || specifier.startsWith('../')) &&
    context.parentURL?.startsWith('file:')
  ) {
    hit = firstExisting(join(dirname(fileURLToPath(context.parentURL)), specifier))
  }
  return hit
    ? nextResolve(pathToFileURL(hit).href, context)
    : nextResolve(specifier, context)
}
