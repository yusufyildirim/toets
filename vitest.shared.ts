import { defineConfig } from 'vitest/config';

/**
 * Export condition under which workspace packages expose their TypeScript sources. Scoped so
 * it never matches the generic `source` condition some third-party packages publish.
 */
export const SOURCE_CONDITION = '@dpad-tv/source';

// Vite's server defaults with the source condition first. Vitest resolves test imports in the
// SSR environment, which does not read the top-level `resolve.conditions`, so set both.
const conditions = [SOURCE_CONDITION, 'module', 'node', 'development|production'];

/** Base Vitest config of every workspace package; extend it with `mergeConfig`. */
export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions, externalConditions: [SOURCE_CONDITION] } },
  test: { include: ['src/**/*.test.ts', 'test/**/*.test.ts'] },
});
