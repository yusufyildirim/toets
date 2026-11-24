import { rm, writeFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { test as base, type TestInfo } from '@playwright/test';
import {
  packageDocsLink,
  ToetsError,
  formatFailureDump,
  screenshotPng,
  type ActionHooks,
  type App,
  type AppRuntime,
  type LogEntry,
} from '@toets/core';
import type { ToetsOptions, ToetsProjectConfig } from './config.js';
import { explainForRunner, withExplainedErrors } from './errors.js';
import { requiredCapabilities, requiresSkipReason } from './requires.js';
import { serialGroupOf } from './serial.js';
import { ToetsWorker, workerArtifactsDir } from './worker.js';

/** Lazily started worker state; nothing boots until a test needs it. */
export interface ToetsWorkerHandle {
  get(): Promise<ToetsWorker>;
}

export interface ToetsTestFixtures {
  /** The app under test on this project's platform. Serial blocks share one instance. */
  app: App;
  /** @internal Skips tests whose `requires()` capabilities the platform lacks. */
  _toetsRequires: void;
}

export interface ToetsWorkerFixtures {
  /** @internal Project config set by `platforms.*()`; do not set it by hand. */
  toets: ToetsProjectConfig | undefined;
  /** @internal */
  _toetsWorker: ToetsWorkerHandle;
}

const debug = (workerIndex: number) => (message: string) => {
  if (process.env.TOETS_DEBUG) process.stderr.write(`[toets w${workerIndex}] ${message}\n`);
};

function notAToetsProject(project: string): ToetsError {
  return new ToetsError('NOT_A_TOETS_PROJECT', `Project "${project}" is not a toets project.`, {
    hint: 'Create projects with platforms.web() / platforms.androidTV() / platforms.tvOS() in defineConfig from @toets/test.',
    docs: packageDocsLink('test', 'config'),
  });
}

/** Turns every action into a boxed `test.step`, with optional per-step artifacts. */
function stepHooks(runtime: AppRuntime, testInfo: TestInfo, options: ToetsOptions): ActionHooks {
  const overrides = new Set<string>();
  return {
    step: (info, run) =>
      base.step(
        info.title,
        async () => {
          if (info.override && !overrides.has(info.override.key)) {
            overrides.add(info.override.key);
            testInfo.annotations.push({
              type: 'toets:key-override',
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

/**
 * The failure dump and screenshot as files in the test's output dir, so the console reporter
 * prints their paths (it truncates inline text) and agents can read them from `test-results/`.
 */
async function attachFailure(runtime: AppRuntime, testInfo: TestInfo): Promise<void> {
  const dump = await runtime.failureDump();
  const dumpPath = testInfo.outputPath('toets-failure.md');
  await writeFile(dumpPath, formatFailureDump(dump));
  await testInfo.attach('toets-failure', { path: dumpPath, contentType: 'text/markdown' });
  if (dump.screenshot?.length) {
    const pngPath = testInfo.outputPath('toets-screenshot.png');
    await writeFile(pngPath, dump.screenshot);
    await testInfo.attach('toets-screenshot', { path: pngPath, contentType: 'image/png' });
  }
}

/** The test's mock server traffic as `toets-network.har` (HAR 1.2), when there was any. */
async function attachNetwork(runtime: AppRuntime, testInfo: TestInfo): Promise<void> {
  const mock = runtime.mock;
  if (!mock?.requests().length) return;
  const body = mock.toHar ? mock.toHar() : { requests: mock.requests() };
  await testInfo.attach(mock.toHar ? 'toets-network.har' : 'toets-requests', {
    body: JSON.stringify(body, null, 2),
    contentType: 'application/json',
  });
}

/**
 * The toets test function: Playwright's `test` with the `app` fixture.
 *
 * ```ts
 * test('opens details', async ({ app }) => {
 *   await app.launch();
 *   await app.focus.pressUntil(Key.RIGHT, app.getByTestId('card_1'));
 *   await app.remote.press(Key.SELECT);
 *   await expect(app.getByTestId('details')).toBeVisible();
 * });
 * ```
 */
export const test = base.extend<ToetsTestFixtures, ToetsWorkerFixtures>({
  toets: [undefined, { option: true, scope: 'worker' }],

  _toetsWorker: [
    async ({ toets }, use, workerInfo) => {
      const log = debug(workerInfo.workerIndex);
      const state: { started: Promise<ToetsWorker> | null } = { started: null };
      await use({
        get: () => {
          if (!toets)
            return Promise.reject(explainForRunner(notAToetsProject(workerInfo.project.name)));
          state.started ??= withExplainedErrors(() =>
            ToetsWorker.start(toets, {
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

  _toetsRequires: [
    async ({ _toetsWorker }, use, testInfo) => {
      const required = requiredCapabilities(testInfo.annotations);
      if (required.length) {
        const worker = await _toetsWorker.get();
        const have = worker.runtime.declaredCapabilities;
        const missing = required.filter((c) => !have.has(c));
        const { sdk, mock } = worker.config.options;
        testInfo.skip(
          missing.length > 0,
          requiresSkipReason(missing, worker.config.platform, { sdk: !!sdk, mock: !!mock }),
        );
      }
      await use();
    },
    { auto: true, box: true },
  ],

  app: [
    async ({ _toetsWorker }, use, testInfo) => {
      const worker = await _toetsWorker.get();
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
        await testInfo.attach('toets-logs', { body: formatLogs(logs), contentType: 'text/plain' });
      await attachNetwork(runtime, testInfo);
      if (video) {
        const path = await driver.stopRecording?.();
        if (path && (options.video === 'on' || failed)) {
          await testInfo.attach('toets-video', {
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
