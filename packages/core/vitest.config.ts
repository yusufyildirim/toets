import { defineConfig } from 'vitest/config';

// Tests run against workspace sources. Vitest resolves through the SSR environment, which
// does not read the top-level `resolve.conditions`.
export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: { include: ['src/**/*.test.ts', 'test/**/*.test.ts'] },
});
