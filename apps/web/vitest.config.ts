import { defineConfig } from 'vitest/config'

// `resolve.tsconfigPaths` reads the `@/*` and `@workspace/ui/*` aliases straight
// from tsconfig.json. That is what retired `scripts/alias-loader.mjs`: the app's
// own modules are now reachable from a test without a bespoke Node loader.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    // Node by default — most of what we test is pure. The few specs that need a
    // DOM opt in per file with `// @vitest-environment jsdom`.
    environment: 'node',
    include: ['{app,hooks,lib}/**/*.test.ts'],
    // No-ops outside jsdom; see the file for why it is needed at all.
    setupFiles: ['./test/setup-dom.ts'],
    coverage: {
      provider: 'v8',
      // Components are deliberately out of scope, so scoping the report to the
      // tested layers keeps the number meaningful instead of diluted.
      include: ['lib/**/*.ts', 'hooks/**/*.ts', 'app/api/**/*.ts'],
      exclude: ['lib/types.ts'],
    },
  },
})
