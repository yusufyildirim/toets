import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  // Vitest runs tests in Vite's SSR environment, which has its own resolve conditions.
  ssr: { resolve: { conditions: ['source'] } },
  test: { include: ['src/**/*.test.ts', 'test/**/*.test.ts'] },
});
