import { existsSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ToetsError, Key, type ElementSnapshot, type Selector, type UINode } from '@toets/core';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import webDriverModule, { createWebDriver, type WebDriver } from '../src/index.js';
import { serveFixtures, type FixtureServer } from './server.js';

interface KeyEventRecord {
  type: string;
  key: string;
  code: string;
  keyCode: number;
  repeat: boolean;
}

let server: FixtureServer;
let artifactsDir: string;

beforeAll(async () => {
  server = await serveFixtures();
  artifactsDir = await mkdtemp(join(tmpdir(), 'toets-driver-web-test-'));
});

afterAll(async () => {
  await server.close();
  await rm(artifactsDir, { recursive: true, force: true });
});

const testId = (value: string): Selector => ({ kind: 'testId', value });

async function one(driver: WebDriver, ...chain: Selector[]): Promise<ElementSnapshot> {
  const found = await driver.query(chain);
  expect(found, `exactly one match for ${JSON.stringify(chain)}`).toHaveLength(1);
  return found[0] as ElementSnapshot;
}

async function text(driver: WebDriver, id: string): Promise<string | null> {
  return (await one(driver, testId(id))).text;
}

async function keyEvents(driver: WebDriver): Promise<KeyEventRecord[]> {
  return driver
    .escapeHatch()
    .evaluate(() => (window as unknown as { __keys: KeyEventRecord[] }).__keys);
}

function flatten(node: UINode): UINode[] {
  return [node, ...node.children.flatMap(flatten)];
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  expect([...png.subarray(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG');
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function expectToetsError(promise: Promise<unknown>, code: string): Promise<ToetsError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ToetsError);
  expect((error as ToetsError).code).toBe(code);
  expect((error as ToetsError).hint).toBeTruthy();
  return error as ToetsError;
}

describe('web driver on the fixture app', () => {
  let driver: WebDriver;

  beforeAll(async () => {
    driver = createWebDriver({}, { app: { url: server.url }, artifactsDir });
    await driver.start();
  });

  afterAll(async () => {
    await driver.stop();
  });

  beforeEach(async () => {
    await driver.launch({ payload: { v: 1 }, clearData: true });
    await driver.drainLogs();
  });

  it('declares an honest capability set', () => {
    expect([...driver.capabilities].sort()).toEqual(
      [
        'deeplink.launch',
        'key.back',
        'key.channel',
        'key.color',
        'key.info',
        'key.longpress',
        'key.media.discrete',
        'key.media.toggle',
        'key.media.seek',
        'key.media.track',
        'key.numeric',
        'logs',
        'platform.events',
        'screenshot.element',
        'text.input',
        'tree.hierarchy',
        'video',
      ].sort(),
    );
    expect(driver.platform).toBe('web');
  });

  it('passes the launch payload as ?__toets=base64url(JSON)', async () => {
    const payload = { v: 1, sdkUrl: 'ws://localhost:9323', token: 't-ü', state: 'home' } as const;
    await driver.launch({ payload });
    expect(await text(driver, 'payload-source')).toBe('query');
    expect(JSON.parse((await text(driver, 'payload')) ?? '')).toEqual(payload);
  });

  it('maps an element to a snapshot', async () => {
    const card = await one(driver, testId('card-1'));
    expect(card).toMatchObject({
      testId: 'card-1',
      text: 'Card 1',
      label: null,
      visible: true,
      inViewport: true,
      focusable: true,
      focused: true,
      focusWithin: true,
      enabled: true,
      selected: false,
      busy: false,
    });
    expect(card.bounds).toEqual({ x: 220, y: 120, width: 300, height: 170 });
    expect(typeof card.ref).toBe('string');
    // Refs are stable for the same element.
    expect((await one(driver, testId('card-1'))).ref).toBe(card.ref);
  });

  it('matches text like Playwright: deepest element, substring, case-insensitive by default', async () => {
    const title = await one(driver, { kind: 'text', value: 'card 3' });
    expect(title.testId).toBeNull();
    expect(title.text).toBe('Card 3');
    expect(await driver.query([{ kind: 'text', value: 'card 3', exact: true }])).toHaveLength(0);
    expect(await driver.query([{ kind: 'text', value: 'Card 3', exact: true }])).toHaveLength(1);
    expect(await driver.query([{ kind: 'text', value: /^Card \d+$/g }])).toHaveLength(10);
    // Raw DOM text: CSS text-transform does not apply.
    expect(await text(driver, 'title')).toBe('toets fixture');
  });

  it('resolves chains within previous matches, in document order', async () => {
    const inRail = await driver.query([testId('rail-1'), { kind: 'text', value: 'card' }]);
    expect(inRail.map((s) => s.text)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Card ${i + 1}`),
    );
    const third = await one(driver, { kind: 'text', value: /card/i }, { kind: 'nth', index: 2 });
    expect(third.text).toBe('Card 3');
    expect(await driver.query([testId('menu'), testId('card-1')])).toHaveLength(0);
    expect(await driver.query([testId('rail-1'), { kind: 'focused' }])).toHaveLength(1);
    expect(await driver.query([testId('menu'), { kind: 'focused' }])).toHaveLength(0);
    expect(await driver.query([testId('nope')])).toEqual([]);
    // The empty chain is the document scope, the root, like core `evaluateChain`.
    expect((await driver.query([])).map((s) => s.ref)).toEqual([(await driver.tree()).root.ref]);
  });

  it('follows DOM focus moved by the app on arrow keys', async () => {
    expect((await driver.focused())?.testId).toBe('card-1');
    await driver.press(Key.RIGHT);
    expect((await driver.focused())?.testId).toBe('card-2');
    expect((await one(driver, testId('rail-1'))).focusWithin).toBe(true);
    expect((await one(driver, testId('menu'))).focusWithin).toBe(false);
    await driver.press(Key.LEFT);
    await driver.press(Key.LEFT);
    expect((await driver.focused())?.testId).toBe('menu-home');
    await driver.press(Key.DOWN);
    expect((await driver.focused())?.testId).toBe('menu-search');
  });

  it('reports viewport intersection through clipping ancestors', async () => {
    const last = await one(driver, testId('card-10'));
    expect(last.visible).toBe(true);
    expect(last.inViewport).toBe(false); // clipped by the rail's overflow: hidden
    for (let i = 0; i < 9; i++) await driver.press(Key.RIGHT);
    expect((await one(driver, testId('card-10'))).inViewport).toBe(true);
    expect((await one(driver, testId('card-1'))).inViewport).toBe(false);
    const below = await one(driver, testId('below-fold'));
    expect(below).toMatchObject({ visible: true, inViewport: false });
  });

  it('reports hidden elements as not visible, with their text', async () => {
    expect(await one(driver, testId('hidden-banner'))).toMatchObject({
      visible: false,
      inViewport: false,
      text: 'Secret banner',
    });
    expect((await one(driver, testId('invisible'))).visible).toBe(false);
    expect((await one(driver, testId('zero'))).visible).toBe(false);
    const contents = await one(driver, testId('contents'));
    expect(contents.visible).toBe(true);
    expect(contents.bounds.width).toBeGreaterThan(0);
  });

  it('reports disabled, selected and busy states', async () => {
    expect((await one(driver, testId('buy'))).enabled).toBe(false);
    expect((await one(driver, testId('buy'))).focusable).toBe(false);
    expect((await one(driver, testId('locked'))).enabled).toBe(false);
    expect((await one(driver, testId('locked-label'))).enabled).toBe(false); // inherited
    expect((await one(driver, testId('play-button'))).enabled).toBe(true);

    expect((await one(driver, testId('menu-home'))).selected).toBe(true);
    await driver.press(Key.SELECT);
    expect((await one(driver, testId('card-1'))).selected).toBe(true);
    expect(await text(driver, 'last-action')).toBe('selected card-1');

    expect((await one(driver, testId('rail-2'))).busy).toBe(true);
    expect((await one(driver, testId('main'))).busy).toBe(true); // descendant is busy
    expect((await one(driver, testId('spinner'))).busy).toBe(false);
    await driver.press(Key.GREEN);
    expect((await one(driver, testId('rail-2'))).busy).toBe(false);
    expect(await text(driver, 'spinner')).toBe('Loaded');
  });

  it('activates buttons with SELECT (Enter produces keypress)', async () => {
    await driver.press(Key.DOWN);
    expect((await driver.focused())?.testId).toBe('play-button');
    await driver.press(Key.SELECT);
    expect(await text(driver, 'last-action')).toBe('play clicked');
  });

  it('reports text fields and enters text into the focused one', async () => {
    const page = driver.escapeHatch();
    await page.evaluate(() => {
      const pw = document.createElement('input');
      pw.type = 'password';
      pw.value = 'secret';
      pw.dataset.testid = 'password';
      document.querySelector('[data-testid="controls"]')?.append(pw);
    });
    expect(await one(driver, testId('search-input'))).toMatchObject({
      editable: true,
      value: 'query   text',
      secure: false,
    });
    expect(await one(driver, testId('password'))).toMatchObject({
      editable: true,
      value: '••••••',
      secure: true,
    });
    expect(await one(driver, testId('play-button'))).toMatchObject({ editable: false });

    const field = await one(driver, testId('search-input'));
    expect(await driver.text.isOpen()).toBe(false);
    await expectToetsError(driver.text.insert('x', null), 'WEB_NO_TEXT_FIELD');
    await page.focus('[data-testid="search-input"]');
    expect(await driver.text.isOpen()).toBe(true);
    await driver.text.replace(field, 'ma');
    await driver.text.insert('trix ü', null);
    await driver.text.deleteBackward(2, null);
    expect((await one(driver, testId('search-input'))).value).toBe('matrix');
    await driver.text.replace(field, '');
    expect((await one(driver, testId('search-input'))).value).toBe('');
  });

  it('reads labels, form values and open shadow DOM', async () => {
    expect((await one(driver, testId('logo'))).label).toBe('toets logo');
    expect((await one(driver, testId('icon-button'))).label).toBe('Open search');
    expect(await text(driver, 'search-input')).toBe('query text');
    expect(await text(driver, 'badge-label')).toBe('New');
    expect(await text(driver, 'badge')).toBe('New Hot');
    const slotted = await driver.query([testId('badge'), testId('badge-slotted')]);
    expect(slotted.map((s) => s.text)).toEqual(['Hot']);
  });

  it('returns the whole UI tree', async () => {
    const tree = await driver.tree();
    expect(tree.viewport).toEqual({ width: 1920, height: 1080 });
    const nodes = flatten(tree.root);
    const ids = nodes.map((n) => n.testId).filter((id) => id !== null);
    expect(ids).toContain('card-10');
    expect(ids).toContain('badge-label');
    expect(nodes.filter((n) => n.focused).map((n) => n.testId)).toEqual(['card-1']);
    // Non-UI elements are skipped.
    expect(nodes.some((n) => n.text?.includes('use strict'))).toBe(false);
    const byRef = new Map(nodes.map((n) => [n.ref, n]));
    expect(byRef.get((await one(driver, testId('card-1'))).ref)?.testId).toBe('card-1');
  });

  it('sends default key values and TV key codes', async () => {
    const sent: [Key, string, number][] = [
      [Key.UP, 'ArrowUp', 38],
      [Key.BACK, 'Escape', 27],
      [Key.INFO, 'Info', 457],
      [Key.PLAY, 'MediaPlay', 415],
      [Key.PAUSE, 'MediaPause', 19],
      [Key.FAST_FORWARD, 'MediaFastForward', 417],
      [Key.RED, 'ColorF0Red', 403],
      [Key.CHANNEL_UP, 'ChannelUp', 427],
      [Key.DIGIT_7, '7', 55],
    ];
    for (const [key] of sent) await driver.press(key);
    const downs = (await keyEvents(driver)).filter((e) => e.type === 'keydown');
    expect(downs.map((e) => [e.key, e.keyCode])).toEqual(sent.map(([, k, c]) => [k, c]));
    const ups = (await keyEvents(driver)).filter((e) => e.type === 'keyup');
    expect(ups).toHaveLength(sent.length);
    expect(await text(driver, 'last-action')).toBe('back');
  });

  it('long-presses as keydown, auto-repeats, keyup', async () => {
    const started = performance.now();
    await driver.press(Key.RIGHT, { holdMs: 800 });
    expect(performance.now() - started).toBeGreaterThanOrEqual(790);
    const events = (await keyEvents(driver)).filter((e) => e.key === 'ArrowRight');
    expect(events[0]).toMatchObject({ type: 'keydown', repeat: false });
    expect(events.at(-1)).toMatchObject({ type: 'keyup' });
    const repeats = events.filter((e) => e.type === 'keydown' && e.repeat);
    // Default timing: first repeat after 500ms, then every 50ms until 800ms.
    expect(repeats).toHaveLength(6);
    expect((await driver.focused())?.testId).toBe('card-8');
  });

  it('controls media with media keys', async () => {
    const paused = () =>
      driver.escapeHatch().evaluate(() => document.querySelector('video')?.paused);
    expect(await paused()).toBe(true);
    await driver.press(Key.PLAY_PAUSE);
    await expect.poll(() => text(driver, 'player-state')).toBe('playing');
    expect(await paused()).toBe(false);
    await driver.press(Key.PAUSE);
    await expect.poll(() => text(driver, 'player-state')).toBe('paused');
  });

  it('takes viewport and element screenshots without scrolling', async () => {
    expect(pngSize(await driver.screenshot())).toEqual({ width: 1920, height: 1080 });
    const card = await one(driver, testId('card-1'));
    expect(pngSize(await driver.screenshot({ element: card.ref }))).toEqual({
      width: 300,
      height: 170,
    });

    const below = await one(driver, testId('below-fold'));
    await expectToetsError(driver.screenshot({ element: below.ref }), 'WEB_ELEMENT_OFFSCREEN');
    expect(await driver.escapeHatch().evaluate(() => window.scrollY)).toBe(0);

    await driver.launch({ payload: { v: 1 } });
    await expectToetsError(driver.screenshot({ element: card.ref }), 'WEB_STALE_ELEMENT');
  });

  it('collects console logs and uncaught errors', async () => {
    await driver.launch({ payload: { v: 1 } });
    const startup = [...(await driver.drainLogs())];
    expect(startup).toContainEqual(
      expect.objectContaining({ level: 'info', message: 'fixture ready', source: 'app' }),
    );
    await driver.press(Key.RED);
    await expect
      .poll(async () => {
        startup.push(...(await driver.drainLogs()));
        return startup.map((l) => `${l.level}:${l.message.split('\n')[0]}`);
      })
      .toEqual(expect.arrayContaining(['error:red pressed', 'error:Uncaught Error: boom']));
    expect(await driver.drainLogs()).toEqual([]);
  });

  it('keeps data across launches and clears it on reset or clearData', async () => {
    expect(await text(driver, 'launches')).toBe('launches 1');
    await driver.launch({ payload: { v: 1 } });
    expect(await text(driver, 'launches')).toBe('launches 2');
    await driver.launch({ payload: { v: 1 }, clearData: true });
    expect(await text(driver, 'launches')).toBe('launches 1');
    await driver.launch({ payload: { v: 1 } });
    await driver.reset();
    expect(driver.escapeHatch().url()).toBe('about:blank');
    await driver.launch({ payload: { v: 1 } });
    expect(await text(driver, 'launches')).toBe('launches 1');
  });

  it('terminates to an empty page', async () => {
    await driver.terminate();
    expect(await driver.query([testId('card-1')])).toEqual([]);
    expect(await driver.focused()).toBeNull();
    expect((await driver.tree()).root.children).toEqual([]);
  });

  it('records video across launches', async () => {
    await driver.startRecording();
    await expectToetsError(driver.startRecording(), 'WEB_RECORDING_ACTIVE');
    await driver.press(Key.RIGHT);
    await driver.launch({ payload: { v: 1 } });
    await driver.press(Key.RIGHT);
    const path = await driver.stopRecording();
    expect(path.startsWith(artifactsDir)).toBe(true);
    expect(path.endsWith('.webm')).toBe(true);
    expect(existsSync(path) && statSync(path).size).toBeGreaterThan(0);
    await expectToetsError(driver.stopRecording(), 'WEB_NOT_RECORDING');
  });

  it('emits network and lifecycle events', async () => {
    const page = driver.escapeHatch();
    await page.evaluate(() => {
      const log: string[] = [];
      (window as unknown as { __events: string[] }).__events = log;
      for (const type of ['online', 'offline']) window.addEventListener(type, () => log.push(type));
      for (const type of ['visibilitychange', 'freeze', 'resume']) {
        document.addEventListener(type, () => log.push(`${type}:${document.visibilityState}`));
      }
    });
    const probe = () =>
      page.evaluate(async () => ({
        events: (window as unknown as { __events: string[] }).__events,
        onLine: navigator.onLine,
        hidden: document.hidden,
        fetched: await fetch(location.href).then(
          () => true,
          () => false,
        ),
      }));

    await driver.emit('network-lost');
    expect(await probe()).toMatchObject({ events: ['offline'], onLine: false, fetched: false });
    await driver.emit('network-restored');
    expect(await probe()).toMatchObject({ onLine: true, fetched: true });

    await driver.emit('suspend');
    expect(await probe()).toMatchObject({ hidden: true });
    await driver.emit('resume');
    expect(await probe()).toEqual({
      events: [
        'offline',
        'online',
        'visibilitychange:hidden',
        'freeze:hidden',
        'resume:visible',
        'visibilitychange:visible',
      ],
      onLine: true,
      hidden: false,
      fetched: true,
    });
  });

  it('rejects unmapped keys with a hint', async () => {
    const error = await expectToetsError(driver.press(Key.HOME), 'WEB_KEY_UNMAPPED');
    expect(error.hint).toContain('key.home');
  });
});

describe('web driver configuration', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser.close();
  });

  it('is the default export as a DriverModule', async () => {
    expect(webDriverModule.platform).toBe('web');
    const driver = await webDriverModule.createDriver(
      { browser },
      { app: { url: server.url }, workerIndex: 0, artifactsDir, log: () => {} },
    );
    expect(driver.platform).toBe('web');
    await expectToetsError(driver.query([]), 'WEB_NOT_STARTED');
  });

  it('passes the payload through an init script as window.__TOETS__', async () => {
    const driver = createWebDriver({ url: server.url, browser, launchTransport: 'initScript' });
    await driver.start();
    try {
      await driver.launch({ payload: { v: 1, mockUrl: 'http://localhost:9999' } });
      expect(await text(driver, 'payload-source')).toBe('global');
      expect(JSON.parse((await text(driver, 'payload')) ?? '')).toEqual({
        v: 1,
        mockUrl: 'http://localhost:9999',
      });
      expect(driver.escapeHatch().url()).toBe(server.url);
      // A relaunch replaces the payload instead of stacking init scripts.
      await driver.launch({ payload: { v: 1, state: 'second' } });
      expect(JSON.parse((await text(driver, 'payload')) ?? '')).toEqual({ v: 1, state: 'second' });
    } finally {
      await driver.stop();
    }
  });

  it('drives a borrowed page without closing it', async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await context.newPage();
    const driver = createWebDriver({ url: server.url, page });
    await driver.start();
    await driver.launch({ payload: { v: 1 } });
    expect(driver.escapeHatch()).toBe(page);
    expect((await driver.tree()).viewport).toEqual({ width: 1280, height: 720 });
    await driver.stop();
    await driver.stop();
    expect(page.isClosed()).toBe(false);
    await context.close();
  });

  it('opens and closes its own context in a borrowed browser', async () => {
    const driver = createWebDriver({ url: server.url, browser });
    const before = browser.contexts().length;
    await driver.start();
    expect(browser.contexts().length).toBe(before + 1);
    await driver.stop();
    expect(browser.contexts().length).toBe(before);
    expect(browser.isConnected()).toBe(true);
  });

  it('opens and closes only its page in a borrowed context', async () => {
    const context = await browser.newContext();
    const driver = createWebDriver({ url: server.url, context });
    await driver.start();
    expect(context.pages()).toHaveLength(1);
    await driver.stop();
    expect(context.pages()).toHaveLength(0);
    await context.close();
  });

  it('applies key overrides and derives capabilities from them', async () => {
    const driver = createWebDriver({
      url: server.url,
      browser,
      keys: {
        BACK: { key: 'XF86Back', keyCode: 10009 },
        HOME: { key: 'BrowserHome', keyCode: 36 },
        RED: null,
      },
    });
    expect(driver.capabilities.has('key.home')).toBe(true);
    expect(driver.capabilities.has('key.back')).toBe(true);
    expect(driver.capabilities.has('key.color')).toBe(false);
    await driver.start();
    try {
      await driver.launch({ payload: { v: 1 } });
      await driver.press(Key.BACK);
      await driver.press(Key.HOME);
      await expectToetsError(driver.press(Key.RED), 'WEB_KEY_UNMAPPED');
      const downs = (await keyEvents(driver)).filter((e) => e.type === 'keydown');
      // Non-standard key values arrive as an empty string; the keyCode is verbatim.
      expect(downs.map((e) => [e.key, e.keyCode])).toEqual([
        ['', 10009],
        ['BrowserHome', 36],
      ]);
    } finally {
      await driver.stop();
    }
  });

  it('explains launch failures', async () => {
    const missing = createWebDriver({ url: `${server.url}missing.html`, browser });
    await missing.start();
    await expectToetsError(missing.launch({ payload: { v: 1 } }), 'WEB_LAUNCH_FAILED');
    await missing.stop();

    const refused = createWebDriver({ url: 'http://127.0.0.1:9/', browser });
    await refused.start();
    await expectToetsError(refused.launch({ payload: { v: 1 } }), 'WEB_LAUNCH_FAILED');
    await refused.stop();
  });

  it('launches from a deep link on its page URL with the payload in an init script', async () => {
    const driver = createWebDriver({ url: server.url, browser });
    await driver.start();
    try {
      expect(driver.deepLinks.open).toBeUndefined();
      const link = driver.deepLinks.translate(new URL('myapp://index.html?route=details#top'));
      expect(link.description).toBe(`${server.url}index.html?route=details#top`);
      await driver.launch({ payload: { v: 1, state: 'linked' }, deepLink: link });
      expect(driver.escapeHatch().url()).toBe(`${server.url}index.html?route=details#top`);
      expect(await text(driver, 'payload-source')).toBe('global');
      expect(JSON.parse((await text(driver, 'payload')) ?? '')).toEqual({ v: 1, state: 'linked' });
      // A plain launch afterwards goes back to the app URL and the query transport.
      await driver.launch({ payload: { v: 1 } });
      expect(await text(driver, 'payload-source')).toBe('query');
    } finally {
      await driver.stop();
    }
  });

  it('fails with DEEPLINK_UNHANDLED when the deep link page is not served', async () => {
    const driver = createWebDriver({
      url: server.url,
      browser,
      deepLink: (link) => `/watch${link.pathname}`,
    });
    await driver.start();
    try {
      const link = driver.deepLinks.translate(new URL('myapp://details/42'));
      expect(link.description).toBe(`${server.url}watch/42`);
      const error = await expectToetsError(
        driver.launch({ payload: { v: 1 }, deepLink: link }),
        'DEEPLINK_UNHANDLED',
      );
      expect(error.message).toBe(`The deep link page ${server.url}watch/42 answered HTTP 404.`);
    } finally {
      await driver.stop();
    }
  });

  it('refuses a deepLink that is not a function', () => {
    expect(() =>
      createWebDriver({ url: server.url, deepLink: 'details' as unknown as () => string }),
    ).toThrow(ToetsError);
  });

  it('explains a missing URL', () => {
    expect(() => createWebDriver({})).toThrow(ToetsError);
  });
});
