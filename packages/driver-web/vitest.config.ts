import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['source'] },
  // Vitest runs tests in the SSR environment, which has its own resolve conditions.
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Integration tests drive a real Chromium.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
