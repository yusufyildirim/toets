import { defineConfig, platforms } from '@toets/test';

/** A toets test config: its `platforms.*()` projects become MCP targets. */
export default defineConfig({
  expect: { timeout: 1500 },
  parityReport: false,
  toets: { keyOverrides: { FAST_FORWARD: { as: 'RIGHT', holdMs: 800 } } },
  projects: [
    { name: 'unit', testMatch: /unit/ },
    platforms.web<{ label?: string }>({
      driver: '../fake-driver-module.ts',
      label: 'From Playwright',
    }),
    platforms.web<{ label?: string }>({
      name: 'web-kids',
      driver: '../fake-driver-module.ts',
      label: 'Kids',
      expect: { timeout: 700 },
      toets: { timeouts: { actionMs: 900 } },
    }),
  ],
});
