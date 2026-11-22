import { join } from 'node:path';
import { defineConfig, Key, platforms } from '@dpad-tv/test';
import { FakeMockServer, FakeSdkHost } from '@dpad-tv/core/testing';
import { registry } from './fake-app.js';

const out = process.env.DPAD_SMOKE_DIR ?? join(import.meta.dirname, '.out');
const mode = process.env.DPAD_SMOKE_MODE ?? 'pass';

export default defineConfig({
  testDir: './specs',
  outputDir: join(out, 'test-results'),
  snapshotPathTemplate: join(out, 'snapshots', '{testFilePath}', '{arg}-{projectName}{ext}'),
  workers: 1,
  retries: 0,
  expect: { timeout: 1000 },
  ...(mode === 'fail' ? { grep: /@failing/ } : { grepInvert: /@failing/ }),
  reporter: [['json', { outputFile: join(out, 'report.json') }]],
  parityReport: { outputFile: join(out, 'parity.md'), summary: false },
  app: { web: { url: 'http://localhost:3000' }, tvOS: { bundleId: 'com.example.tv' } },
  dpad: {
    timeouts: { actionMs: 1000, navigationSettleMs: 30, sdkConnectMs: 500 },
    remote: { intervalMs: 0 },
  },
  projects: [
    platforms.web({
      driver: './fake-web-driver.ts',
      dpad: {
        steps: { snapshot: true },
        mock: { createServer: async () => (registry.mock = new FakeMockServer()) },
        sdk: {
          createHost: async () => {
            if (!registry.driver) throw new Error('driver must exist before the SDK host');
            return (registry.host = new FakeSdkHost(registry.driver));
          },
        },
      },
    }),
    platforms.tvOS({
      driver: './fake-tvos-driver.ts',
      devices: { mode: 'external', addresses: ['FAKE-APPLE-TV'] },
      dpad: { keyOverrides: { FAST_FORWARD: { key: Key.RIGHT, holdMs: 800 } } },
    }),
  ],
});
