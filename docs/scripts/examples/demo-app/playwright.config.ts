/**
 * Runs the docs' `run` test examples against the demo app (see app.ts). `check-examples.ts`
 * writes the examples to `TOETS_EXAMPLES_DIR` and points this config at them.
 */
import { join } from 'node:path';
import { FakeSdkHost } from '@toets/core/testing';
import { defineConfig, http, HttpResponse, platforms } from '@toets/test';
import { API_ORIGIN, registry, type RailData } from './app.ts';

const examplesDir = process.env.TOETS_EXAMPLES_DIR;
if (!examplesDir) throw new Error('TOETS_EXAMPLES_DIR is not set; run check-examples.ts');

const rails: RailData[] = [
  { id: '0', titles: ['Big Buck Bunny', 'Sintel', 'Tears of Steel', 'Elephants Dream'] },
  { id: '1', titles: ['Cosmos Laundromat', 'Spring', 'Agent 327', 'Caminandes'] },
  { id: 'popular', titles: ['Coffee Run', 'Charge', 'Sprite Fright', 'Hero'] },
];

export default defineConfig({
  testDir: examplesDir,
  testMatch: '**/*.spec.ts',
  outputDir: join(examplesDir, '.results'),
  workers: 1,
  retries: 0,
  timeout: 15_000,
  expect: { timeout: 2_000 },
  reporter: [['json', { outputFile: join(examplesDir, '.results', 'report.json') }]],
  parityReport: false,
  app: { web: { url: API_ORIGIN } },
  toets: {
    timeouts: { navigationSettleMs: 20, sdkConnectMs: 1_000 },
    remote: { intervalMs: 0 },
    // The app's baseline data; examples override it per test with `app.network.use()`.
    mock: {
      handlers: [
        http.get('*/v1/rails', () => HttpResponse.json(rails)),
        http.get('*/api/favorites', () => HttpResponse.json([{ id: 'f1' }])),
        http.get('*/api/watchlist', () => HttpResponse.json([{ id: 'w1' }])),
        http.post('*/v1/likes', () => new HttpResponse(null, { status: 201 })),
      ],
      onUnhandledRequest: 'reject',
    },
    // Media and launch states come from the SDK; focus stays black-box (driver geometry).
    sdk: {
      createHost: async () => {
        if (!registry.app) throw new Error('the demo driver must start before the SDK host');
        return (registry.host = new FakeSdkHost(registry.app, {
          domains: ['sync', 'media', 'state', 'logs'],
        }));
      },
    },
  },
  projects: [platforms.web({ name: 'demo', driver: './driver.ts' })],
});
