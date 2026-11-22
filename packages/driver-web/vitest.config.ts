import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../../vitest.shared.ts';

export default mergeConfig(
  base,
  defineConfig({
    // Integration tests drive a real Chromium.
    test: { testTimeout: 30_000, hookTimeout: 60_000 },
  }),
);
