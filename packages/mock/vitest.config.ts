import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  // Tests run in Vite's SSR environment, which resolves workspace packages separately.
  ssr: { resolve: { conditions: ['source'] } },
  test: { include: ['src/**/*.test.ts', 'test/**/*.test.ts'] },
});
