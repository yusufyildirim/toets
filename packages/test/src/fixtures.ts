import { rm } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { test as base, type TestInfo } from '@playwright/test';
import {
  packageDocsLink,
  DpadError,
  formatFailureDump,
  screenshotPng,
  type ActionHooks,
  type App,
  type AppRuntime,
  type LogEntry,
} from '@dpad-tv/core';
import type { DpadOptions, DpadProjectConfig } from './config.js';
import { explainForRunner, withExplainedErrors } from './errors.js';
import { requiredCapabilities } from './requires.js';
import { serialGroupOf } from './serial.js';
import { DpadWorker, workerArtifactsDir } from './worker.js';

/** Lazily started worker state; nothing boots until a test needs it. */
export interface DpadWorkerHandle {
  get(): Promise<DpadWorker>;
}

export interface DpadTestFixtures {
  /** The app under test on this project's platform. Serial blocks share one instance. */
  app: App;
  /** @internal Skips tests whose `requires()` capabilities the platform lacks. */
  _dpadRequires: void;
}

export interface DpadWorkerFixtures {
  /** @internal Project config set by `platforms.*()`; do not set it by hand. */
  dpad: DpadProjectConfig | undefined;
  /** @internal */
  _dpadWorker: DpadWorkerHandle;
}

const debug = (workerIndex: number) => (message: string) => {
  if (process.env.DPAD_DEBUG) process.stderr.write(`[dpad w${workerIndex}] ${message}\n`);
};

function notADpadProject(project: string): DpadError {
  return new DpadError('NOT_A_DPAD_PROJECT', `Project "${project}" is not a dpad project.`, {
    hint: 'Create projects with platforms.web() / platforms.androidTV() / platforms.tvOS() in defineConfig from @dpad-tv/test.',
    docs: packageDocsLink('test', 'config'),
  });
}

/** Turns every action into a boxed `test.step`, with optional per-step artifacts. */
function stepHooks(runtime: AppRuntime, testInfo: TestInfo, options: DpadOptions): ActionHooks {
  const overrides = new Set<string>();
  return {
    step: (info, run) =>
      base.step(
        info.title,
        async () => {
          if (info.override && !overrides.has(info.override.key)) {
            overrides.add(info.override.key);
            testInfo.annotations.push({
              type: 'dpad:key-override',
              description: `${info.override.key} = ${info.override.performedAs}`,
            });
          }
          const result = await withExplainedErrors(run);
          if (options.steps?.screenshot) {
            const png = screenshotPng(await runtime.app.screenshot());
            await testInfo.attach('step-screenshot', {
              body: Buffer.from(png),
              contentType: 'image/png',
            });
          }
          if (options.steps?.snapshot) {
            await testInfo.attach('step-snapshot', {
              body: await runtime.app.snapshot(),
              contentType: 'text/yaml',
            });
          }
          return result;
        },
        { box: true },
      ),
  };
}

const formatLogs = (logs: readonly LogEntry[]): string =>
  logs
    .map((l) => `${new Date(l.timestamp).toISOString()} ${l.level} [${l.source}] ${l.message}`)
    .join('\n') + '\n';

async function attachFailure(runtime: AppRuntime, testInfo: TestInfo): Promise<void> {
  const dump = await runtime.failureDump();
  await testInfo.attach('dpad-failure', {
    body: formatFailureDump(dump),
    contentType: 'text/markdown',
  });
  if (dump.screenshot?.length) {
    await testInfo.attach('dpad-screenshot', {
      body: Buffer.from(dump.screenshot),
      contentType: 'image/png',
    });
  }
}

/** The test's mock server traffic as `dpad-network.har` (HAR 1.2), when there was any. */
async function attachNetwork(runtime: AppRuntime, testInfo: TestInfo): Promise<void> {
  const mock = runtime.mock;
  if (!mock?.requests().length) return;
  const body = mock.toHar ? mock.toHar() : { requests: mock.requests() };
  await testInfo.attach(mock.toHar ? 'dpad-network.har' : 'dpad-requests', {
    body: JSON.stringify(body, null, 2),
    contentType: 'application/json',
  });
}

/**
 * The dpad test function: Playwright's `test` with the `app` fixture.
 *
 * ```ts
 * test('opens details', async ({ app }) => {
 *   await app.launch();
 *   await app.focus.navigateTo(app.getByTestId('card_1'));
 *   await app.remote.press(Key.SELECT);
 *   await expect(app.getByTestId('details')).toBeVisible();
 * });
 * ```
 */
export const test = base.extend<DpadTestFixtures, DpadWorkerFixtures>({
  dpad: [undefined, { option: true, scope: 'worker' }],

  _dpadWorker: [
    async ({ dpad }, use, workerInfo) => {
      const log = debug(workerInfo.workerIndex);
      const state: { started: Promise<DpadWorker> | null } = { started: null };
      await use({
        get: () => {
          if (!dpad)
            return Promise.reject(explainForRunner(notADpadProject(workerInfo.project.name)));
          state.started ??= withExplainedErrors(() =>
            DpadWorker.start(dpad, {
              workerIndex: workerInfo.workerIndex,
              parallelIndex: workerInfo.parallelIndex,
              configDir: workerInfo.config.configFile
                ? dirname(workerInfo.config.configFile)
                : process.cwd(),
              artifactsDir: workerArtifactsDir(
                workerInfo.project.outputDir,
                workerInfo.workerIndex,
              ),
              log,
            }),
          );
          return state.started;
        },
      });
      const worker = await state.started?.catch(() => null);
      await worker?.stop(log);
    },
    { scope: 'worker', box: true },
  ],

  _dpadRequires: [
    async ({ _dpadWorker }, use, testInfo) => {
      const required = requiredCapabilities(testInfo.annotations);
      if (required.length) {
        const worker = await _dpadWorker.get();
        const have = worker.runtime.declaredCapabilities;
        const missing = required.filter((c) => !have.has(c));
        testInfo.skip(
          missing.length > 0,
          `requires ${missing.join(', ')}: not available on ${worker.config.platform}`,
        );
      }
      await use();
    },
    { auto: true, box: true },
  ],

  app: [
    async ({ _dpadWorker }, use, testInfo) => {
      const worker = await _dpadWorker.get();
      const runtime = worker.runtime;
      const options = worker.config.options;

      const group = serialGroupOf(testInfo);
      if (group === null || group !== worker.lastGroup) {
        await runtime.isolate();
      } else {
        // Same serial group: keep the app, its SDK session and mock handlers.
        runtime.mock?.clearRequests();
      }
      worker.lastGroup = group;

      const driver = runtime.driver;
      const video =
        (options.video ?? 'off') !== 'off' &&
        runtime.capabilities.has('video') &&
        !!driver.startRecording &&
        !!driver.stopRecording;
      if (video) await driver.startRecording?.();

      runtime.setHooks(stepHooks(runtime, testInfo, options));
      try {
        await use(runtime.app);
      } finally {
        runtime.setHooks(undefined);
      }

      const failed = testInfo.status !== testInfo.expectedStatus;
      if (failed) await attachFailure(runtime, testInfo);
      const logs = await runtime.takeLogs();
      if (logs.length)
        await testInfo.attach('dpad-logs', { body: formatLogs(logs), contentType: 'text/plain' });
      await attachNetwork(runtime, testInfo);
      if (video) {
        const path = await driver.stopRecording?.();
        if (path && (options.video === 'on' || failed)) {
          await testInfo.attach('dpad-video', {
            path,
            contentType: extname(path) === '.webm' ? 'video/webm' : 'video/mp4',
          });
        } else if (path) {
          await rm(path, { force: true });
        }
      }
    },
    { box: true },
  ],
});
