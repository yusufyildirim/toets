/**
 * Runs the real driver (Appium UiAutomator2 + adb) against the native fixture app on a real
 * Android TV emulator. Skipped unless `TOETS_ANDROID_SERIAL` names a booted device:
 *
 *   TOETS_ANDROID_SERIAL=emulator-5554 pnpm --filter @toets/driver-android-tv test:device
 *
 * The fixture APK is built with Gradle when missing (`pnpm fixture:build`).
 */
import {
  Key,
  type DriverCreateContext,
  type ElementSnapshot,
  type SelectorChain,
} from '@toets/core';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAndroidTvDriver, type AndroidTvDriver } from '../src/index.js';

const serial = process.env.TOETS_ANDROID_SERIAL;
const fixtureDir = join(import.meta.dirname, '..', 'fixtures', 'android-tv-app');
const apk = join(fixtureDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

const byId = (value: string): SelectorChain => [{ kind: 'testId', value }];

/** Polls like the core does: drivers never wait, tests do. */
async function waitFor<T>(
  fn: () => Promise<T>,
  ok: (v: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await fn();
  while (!ok(last)) {
    if (Date.now() > deadline) throw new Error(`Timed out; last value: ${JSON.stringify(last)}`);
    await new Promise((r) => setTimeout(r, 100));
    last = await fn();
  }
  return last;
}

describe.skipIf(!serial)('android-tv driver on a real emulator', () => {
  let driver: AndroidTvDriver;
  let server: Server;
  let mockPort = 0;
  const artifactsDir = mkdtempSync(join(tmpdir(), 'toets-android-it-'));
  const latency: Record<string, number[]> = {};

  async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    const out = await fn();
    (latency[name] ??= []).push(performance.now() - start);
    return out;
  }

  const textOf = async (id: string) => (await driver.query(byId(id)))[0]?.text ?? null;
  const focusedId = async () => (await driver.focused())?.testId ?? null;
  const pressAndExpectFocus = async (key: Key, expected: string) => {
    await timed('press', () => driver.press(key));
    await waitFor(focusedId, (id) => id === expected);
  };

  beforeAll(async () => {
    if (!existsSync(apk)) {
      execFileSync('./gradlew', ['assembleDebug', '-q'], { cwd: fixtureDir, stdio: 'inherit' });
    }
    server = createServer((req, res) => {
      res.end(req.url === '/fixture/hello' ? 'hello from host' : 'unknown');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    mockPort = (server.address() as { port: number }).port;

    const ctx: DriverCreateContext = {
      app: { package: 'tv.toets.fixture', apk },
      device: {
        id: serial!,
        platform: 'android-tv',
        address: serial!,
        meta: {},
        release: async () => {},
      },
      workerIndex: 0,
      artifactsDir,
      log: (m) => console.log(m),
    };
    driver = createAndroidTvDriver({}, ctx);
    await timed('start', () => driver.start());
  }, 600_000);

  afterAll(async () => {
    await driver?.stop();
    await new Promise((r) => server?.close(r));
    const rows = Object.entries(latency).map(([action, samples]) => {
      const sorted = [...samples].sort((a, b) => a - b);
      const pick = (q: number) =>
        Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!);
      return { action, n: samples.length, p50: pick(0.5), p90: pick(0.9), max: pick(1) };
    });
    console.table(rows);
    writeFileSync(join(artifactsDir, 'latency.json'), JSON.stringify(rows, null, 2));
    console.log(`artifacts: ${artifactsDir}`);
  }, 120_000);

  it('launches with the payload as an intent extra and reverses its ports', async () => {
    await timed('launch', () =>
      driver.launch({
        payload: { v: 1, state: 'home', mockUrl: `http://localhost:${mockPort}` },
        clearData: true,
      }),
    );
    await waitFor(
      () => textOf('launch_payload'),
      (t) => t === 'payload: state=home',
    );
    await waitFor(
      () => textOf('mock_result'),
      (t) => t === 'mock: hello from host',
    );
  }, 60_000);

  it('maps the page source to snapshots', async () => {
    const tree = await timed('tree', () => driver.tree());
    expect(tree.viewport).toEqual({ width: 1920, height: 1080 });

    const focused = await timed('focused', () => driver.focused());
    expect(focused).toMatchObject({
      testId: 'card_0',
      text: 'Item 0',
      focused: true,
      focusable: true,
    });

    const [disabled] = await timed('query', () => driver.query(byId('disabled_button')));
    expect(disabled).toMatchObject({
      text: 'Unavailable',
      label: 'Not available yet',
      enabled: false,
      visible: true,
    });

    const [menuHome] = await driver.query(byId('menu_home'));
    expect(menuHome?.selected).toBe(true);

    const [rail] = await driver.query(byId('rail'));
    expect(rail).toMatchObject({ focusWithin: true, focused: false });
    expect(rail?.text).toContain('Item 0 Item 1');

    const byText = await driver.query([{ kind: 'text', value: 'item 2' }]);
    expect(byText.map((s) => s.testId)).toEqual(['card_2']);
    const scoped = await driver.query([
      ...byId('rail'),
      { kind: 'text', value: /^Item \d$/ },
      { kind: 'nth', index: 1 },
    ]);
    expect(scoped.map((s) => s.testId)).toEqual(['card_1']);

    // The last card is scrolled out of the rail.
    const [last] = await driver.query(byId('card_9'));
    expect(last?.inViewport ?? false).toBe(false);
  });

  it('moves focus with the D-pad and navigates screens', async () => {
    await pressAndExpectFocus(Key.RIGHT, 'card_1');
    await pressAndExpectFocus(Key.LEFT, 'card_0');
    await pressAndExpectFocus(Key.RIGHT, 'card_1');
    await pressAndExpectFocus(Key.SELECT, 'play_button');
    expect(await textOf('details_title')).toBe('Item 1');
    await pressAndExpectFocus(Key.BACK, 'card_1');
  }, 60_000);

  it('drives the fake player with media keys', async () => {
    await pressAndExpectFocus(Key.SELECT, 'play_button');
    await driver.press(Key.SELECT);
    await waitFor(
      () => textOf('player_state'),
      (t) => t === 'playing',
    );
    const steps: [Key, string, string][] = [
      [Key.PLAY_PAUSE, 'paused', 'position: 0'],
      [Key.PLAY, 'playing', 'position: 0'],
      [Key.PAUSE, 'paused', 'position: 0'],
      [Key.FAST_FORWARD, 'paused', 'position: 10'],
      [Key.FAST_FORWARD, 'paused', 'position: 20'],
      [Key.REWIND, 'paused', 'position: 10'],
      [Key.STOP, 'paused', 'position: 0'],
    ];
    for (const [key, state, position] of steps) {
      await timed('press', () => driver.press(key));
      await waitFor(
        async () => [await textOf('player_state'), await textOf('player_position')],
        ([s, p]) => s === state && p === position,
      );
    }
    await pressAndExpectFocus(Key.BACK, 'play_button');
    await pressAndExpectFocus(Key.BACK, 'card_1');
  }, 60_000);

  it('delivers every remote key with its Android keycode', async () => {
    const expected: [Key, string][] = [
      [Key.MENU, 'KEYCODE_MENU'],
      [Key.INFO, 'KEYCODE_INFO'],
      [Key.NEXT, 'KEYCODE_MEDIA_NEXT'],
      [Key.PREVIOUS, 'KEYCODE_MEDIA_PREVIOUS'],
      [Key.RED, 'KEYCODE_PROG_RED'],
      [Key.GREEN, 'KEYCODE_PROG_GREEN'],
      [Key.YELLOW, 'KEYCODE_PROG_YELLOW'],
      [Key.BLUE, 'KEYCODE_PROG_BLUE'],
      [Key.CHANNEL_UP, 'KEYCODE_CHANNEL_UP'],
      [Key.CHANNEL_DOWN, 'KEYCODE_CHANNEL_DOWN'],
      ...Array.from(
        { length: 10 },
        (_, d) => [`DIGIT_${d}` as Key, `KEYCODE_${d}`] as [Key, string],
      ),
    ];
    for (const [key, code] of expected) {
      await timed('press', () => driver.press(key));
      await waitFor(
        () => textOf('last_key'),
        (t) => t === `last key: ${code}`,
      );
    }
  }, 120_000);

  it('holds a key for the requested time with auto-repeat', async () => {
    expect(await focusedId()).toBe('card_1');
    await timed('press (hold 1000ms)', () => driver.press(Key.RIGHT, { holdMs: 1000 }));
    const hold = await waitFor(
      () => textOf('key_hold'),
      (t) => /ms=\d+/.test(t ?? ''),
    );
    const ms = Number(/ms=(\d+)/.exec(hold!)![1]);
    expect(ms).toBeGreaterThanOrEqual(1000);
    expect(ms).toBeLessThan(1100);
    // A 1 s hold auto-repeats ~12 times: focus runs to the end of the rail.
    expect(await focusedId()).toBe('card_9');
  }, 60_000);

  it('takes viewport and element screenshots', async () => {
    const png = PNG.sync.read(Buffer.from(await timed('screenshot', () => driver.screenshot())));
    expect([png.width, png.height]).toEqual([1920, 1080]);
    const [card] = (await driver.query(byId('card_9'))) as [ElementSnapshot];
    const el = PNG.sync.read(
      Buffer.from(
        await timed('screenshot (element)', () => driver.screenshot({ element: card.ref })),
      ),
    );
    expect([el.width, el.height]).toEqual([card.bounds.width, card.bounds.height]);
  });

  it('collects app logs from logcat', async () => {
    await new Promise((r) => setTimeout(r, 500));
    const logs = await driver.drainLogs();
    expect(
      logs.some((l) => l.source === 'app' && l.message.startsWith('ToetsFixture: launch payload')),
    ).toBe(true);
    expect(
      logs.every((l) => l.source !== 'device' || l.level === 'warn' || l.level === 'error'),
    ).toBe(true);
  });

  it('records the screen', async () => {
    await driver.startRecording();
    await new Promise((r) => setTimeout(r, 1500));
    await driver.press(Key.LEFT);
    await new Promise((r) => setTimeout(r, 1000));
    const file = await driver.stopRecording();
    expect(statSync(file).size).toBeGreaterThan(1000);
  }, 60_000);

  it('measures action latency', async () => {
    for (let i = 0; i < 20; i++) {
      await timed('tree', () => driver.tree());
      await timed('focused', () => driver.focused());
      await timed('query', () => driver.query(byId('card_3')));
      await timed('press', () => driver.press(i % 2 ? Key.RIGHT : Key.LEFT));
    }
    for (let i = 0; i < 5; i++) await timed('screenshot', () => driver.screenshot());
    for (let i = 0; i < 3; i++) {
      await timed('press (hold 500ms)', () =>
        driver.press(i % 2 ? Key.RIGHT : Key.LEFT, { holdMs: 500 }),
      );
    }
    for (let i = 0; i < 5; i++) await timed('launch', () => driver.launch({ payload: { v: 1 } }));
  }, 180_000);

  it('resets app data and terminates', async () => {
    await timed('reset', () => driver.reset());
    await driver.launch({ payload: { v: 1 } });
    await waitFor(
      () => textOf('launch_payload'),
      (t) => t === 'payload: none' || t === 'payload: state=-',
    );
    await timed('press', () => driver.press(Key.HOME));
    await waitFor(
      () => driver.query(byId('home_title')),
      (r) => r.length === 0,
    );
    await timed('terminate', () => driver.terminate());
  }, 60_000);
});
