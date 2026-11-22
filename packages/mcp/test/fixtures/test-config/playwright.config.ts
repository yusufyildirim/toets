import { defineConfig, platforms } from '@dpad-tv/test';

/** A dpad test config: its `platforms.*()` projects become MCP targets. */
export default defineConfig({
  expect: { timeout: 1500 },
  parityReport: false,
  dpad: { keyOverrides: { FAST_FORWARD: { as: 'RIGHT', holdMs: 800 } } },
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
      dpad: { timeouts: { actionMs: 900 } },
    }),
  ],
});
