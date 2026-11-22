/**
 * Drives the SwiftUI fixture app on a real tvOS simulator through the real driver (Appium,
 * WebDriverAgent, simctl). Skipped unless a simulator is provided:
 *
 *   DPAD_TVOS_UDID=<udid> [DPAD_TVOS_DEVICE_SET=<path>] [DPAD_TVOS_APP=<path to .app>] \
 *     pnpm --filter @dpad-tv/driver-tvos test test/integration
 *
 * The fixture is built on demand with `fixtures/tvos-app/build.sh`. Per-action latencies are
 * printed at the end (see docs/capabilities.md).
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Key, type ElementSnapshot } from '@dpad-tv/core';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TvosDriver } from '../../src/index.js';

const udid = process.env.DPAD_TVOS_UDID;
const deviceSet = process.env.DPAD_TVOS_DEVICE_SET;
const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'fixtures',
  'tvos-app',
);
const appPath = process.env.DPAD_TVOS_APP ?? join(fixtureDir, 'build', 'DpadFixture.app');

const latencies = new Map<string, number[]>();
async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    latencies.set(label, [...(latencies.get(label) ?? []), performance.now() - t0]);
  }
}

describe.skipIf(!udid)('tvOS driver on the fixture app', () => {
  let driver: TvosDriver;
  let artifactsDir: string;

  /** The driver never waits; tests poll like the core's retry engine does. */
  async function waitFor<T>(
    what: string,
    read: () => Promise<T>,
    ok: (v: T) => boolean,
    timeoutMs = 10_000,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last: T;
    do {
      last = await read();
      if (ok(last)) return last;
      await new Promise((r) => setTimeout(r, 200));
    } while (Date.now() < deadline);
    throw new Error(`Timed out waiting for ${what}; last value: ${JSON.stringify(last)}`);
  }

  const byId = async (testId: string): Promise<ElementSnapshot | undefined> =>
    (await timed('query', () => driver.query([{ kind: 'testId', value: testId }])))[0];
  const focusedId = async () => (await timed('focused', () => driver.focused()))?.testId ?? null;
  const waitFocus = (testId: string) =>
    waitFor(`focus on ${testId}`, focusedId, (id) => id === testId);
  const waitText = (testId: string, text: string) =>
    waitFor(
      `${testId} to read "${text}"`,
      () => byId(testId),
      (el) => el?.text === text,
    );
  const press = (key: Key, holdMs?: number) =>
    timed(holdMs ? 'press (long)' : 'press', () =>
      driver.press(key, holdMs ? { holdMs } : undefined),
    );

  beforeAll(async () => {
    if (!process.env.DPAD_TVOS_APP && !existsSync(appPath)) {
      execFileSync(join(fixtureDir, 'build.sh'), { stdio: 'inherit' });
    }
    artifactsDir = await mkdtemp(join(tmpdir(), 'dpad-tvos-it-'));
    driver = new TvosDriver(
      { udid: udid!, ...(deviceSet ? { deviceSet } : {}) },
      {
        app: { bundleId: 'tv.dpad.fixture', app: appPath },
        workerIndex: 0,
        artifactsDir,
        log: (m) => console.log(`[driver-tvos] ${m}`),
      },
    );
    await timed('start', () => driver.start());
  }, 900_000);

  afterAll(async () => {
    await driver?.stop();
    const rows = [...latencies].map(([label, ms]) => {
      const sorted = [...ms].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length / 2)]!;
      return `${label.padEnd(14)} n=${String(ms.length).padStart(3)}  p50=${p50.toFixed(0)}ms  max=${sorted.at(-1)!.toFixed(0)}ms`;
    });
    console.log(`tvOS driver latencies:\n${rows.join('\n')}\nArtifacts: ${artifactsDir}`);
    if (artifactsDir && !process.env.DPAD_KEEP_ARTIFACTS) {
      await rm(artifactsDir, { recursive: true, force: true });
    }
  });

  it('launches with the payload as launch arguments and lands focus on the rail', async () => {
    await timed('launch', () => driver.launch({ payload: { v: 1, state: 'home' } }));
    await waitText('payload_state', 'payload: home');
    await waitFocus('rail_item_1');
  });

  it('moves focus with real remote presses', async () => {
    await press(Key.RIGHT);
    await waitFocus('rail_item_2');
    await press(Key.DOWN);
    await waitFor('focus below the rail', focusedId, (id) => id === 'settings_button');
    await press(Key.UP);
    await waitFor(
      'focus back on the rail',
      focusedId,
      (id) => id?.startsWith('rail_item_') ?? false,
    );
  });

  it('maps tree state: text, enabled, focusWithin, viewport', async () => {
    const tree = await timed('tree', () => driver.tree());
    expect(tree.viewport.width).toBeGreaterThan(0);
    expect((await byId('title'))?.text).toBe('dpad fixture');
    expect((await byId('disabled_button'))?.enabled).toBe(false);
    expect((await byId('rail'))?.focusWithin).toBe(true);
    expect((await byId('rail_item_8'))?.inViewport).toBe(false);
  });

  it('opens details with SELECT, long-presses for the context menu and goes BACK', async () => {
    await driver.launch({ payload: { v: 1 } });
    await waitFocus('rail_item_1');
    await press(Key.SELECT);
    await waitText('details_title', 'Details Item 1');
    await press(Key.RIGHT);
    await waitFocus('like_button');
    await press(Key.SELECT, 1500);
    await waitFor(
      'the context menu',
      () => byId('context_reset'),
      (el) => !!el?.visible,
    );
    await press(Key.BACK);
    await waitFor(
      'the context menu to close',
      () => byId('context_reset'),
      (el) => !el,
    );
    await press(Key.BACK);
    await waitFocus('rail_item_1');
  });

  it('toggles the fake player with PLAY_PAUSE', async () => {
    await driver.launch({ payload: { v: 1, state: 'details' } });
    await waitText('details_title', 'Details Item 1');
    await waitFocus('play_button');
    await press(Key.SELECT);
    await waitText('player_state', 'playing');
    await press(Key.PLAY_PAUSE);
    await waitText('player_state', 'paused');
  });

  it('takes viewport and element screenshots', async () => {
    const full = PNG.sync.read(Buffer.from(await timed('screenshot', () => driver.screenshot())));
    const tree = await driver.tree();
    expect(full.width / tree.viewport.width).toBeGreaterThanOrEqual(1);
    const title = (await byId('player_title'))!;
    const el = PNG.sync.read(
      Buffer.from(await timed('screenshot (el)', () => driver.screenshot({ element: title.ref }))),
    );
    const scale = full.width / tree.viewport.width;
    expect(el.width).toBeCloseTo(title.bounds.width * scale, -1);
  });

  it('collects the app log', async () => {
    const logs = await waitFor(
      'app log lines',
      () => driver.drainLogs(),
      (entries) => entries.some((e) => e.message.includes('dpad-fixture:')),
    );
    expect(logs.every((e) => e.source === 'app' || e.source === 'driver')).toBe(true);
  });

  it('records video', async () => {
    await driver.startRecording();
    await press(Key.PLAY_PAUSE);
    await new Promise((r) => setTimeout(r, 1500));
    const video = await driver.stopRecording();
    expect((await stat(video)).size).toBeGreaterThan(0);
  });

  it('terminates and clears data', async () => {
    await timed('terminate', () => driver.terminate());
    await timed('reset', () => driver.reset());
  });
});
