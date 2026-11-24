/**
 * The full stack on a real tvOS simulator: Playwright Test -> @toets/test -> the tvOS driver
 * -> the driver's SwiftUI fixture app. Run through `test/tvos.test.ts`:
 *
 *   TOETS_TVOS_UDID=<udid> pnpm --filter @toets/test test test/tvos.test.ts   # external device
 *   TOETS_TVOS_MANAGED=1 pnpm --filter @toets/test test test/tvos.test.ts     # managed simulator
 */
import { join } from 'node:path';
import { defineConfig, platforms } from '@toets/test';

const out = process.env.TOETS_TVOS_OUT ?? join(import.meta.dirname, '.out');
const udid = process.env.TOETS_TVOS_UDID;

export default defineConfig({
  testDir: './specs',
  outputDir: join(out, 'test-results'),
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['json', { outputFile: join(out, 'report.json') }]],
  parityReport: { outputFile: join(out, 'parity.md'), summary: false },
  app: {
    tvOS: {
      bundleId: 'tv.toets.fixture',
      app: '../../../driver-tvos/fixtures/tvos-app/build/ToetsFixture.app',
    },
  },
  toets: { video: 'on' },
  projects: [
    platforms.tvOS({
      devices: udid ? { mode: 'external', addresses: [udid] } : 'managed',
      // A managed run creates its own simulator; never reuse the one a human may be looking at.
      managed: { namePrefix: 'toets-it' },
    }),
  ],
});
