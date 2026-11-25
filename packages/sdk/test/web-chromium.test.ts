import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { encodeLaunchPayloadParam, type ProtocolNode } from '@toets/protocol';
import { createSdkHost, type SdkHost, type SdkSession } from '@toets/protocol/host';
import { formatConformanceReport, runConformance } from '@toets/protocol/conformance';
import { bundleFixture, chromiumAvailable, launchChromium, serveApp } from './chromium.js';

let browser: Browser;
let app: { url: string; close: () => Promise<void> };

const available = chromiumAvailable();
if (!available) console.warn('[toets] Chromium not installed: skipping web adapter browser tests');

beforeAll(async () => {
  if (!available) return;
  app = await serveApp(await bundleFixture('./fixtures/conformance-app.ts'));
  browser = await launchChromium();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
});

describe.skipIf(!available)('web adapter in Chromium', () => {
  it('passes the protocol conformance suite', { timeout: 120_000 }, async () => {
    let page: Page | undefined;
    const report = await runConformance({
      name: '@toets/sdk/web in Chromium',
      fixture: true,
      launch: async ({ encoded }) => {
        page = await browser.newPage();
        await page.goto(`${app.url}/?__toets=${encoded}`);
      },
      terminate: async () => {
        await page?.close();
        page = undefined;
      },
    });
    const text = formatConformanceReport(report);
    expect(report.passed, text).toBe(true);
    expect(report.results.filter((r) => r.status === 'skip').map((r) => r.id)).toEqual([
      'rpc.domain-unavailable',
    ]);
  });

  describe('round trip', () => {
    let host: SdkHost;
    let page: Page;
    let session: SdkSession;

    beforeAll(async () => {
      host = await createSdkHost();
      const token = host.issueToken();
      page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.goto(
        `${app.url}/?__toets=${encodeLaunchPayloadParam({ v: 1, sdkUrl: host.url, token })}`,
      );
      session = await host.waitForSession(token, { timeoutMs: 10_000 });
    }, 30_000);

    afterAll(async () => {
      await page?.close();
      await host?.close();
    });

    const find = (root: ProtocolNode, testId: string): ProtocolNode | undefined =>
      root.testId === testId ? root : root.children.map((c) => find(c, testId)).find(Boolean);

    it('maps the real DOM with layout', async () => {
      const { root, viewport } = await session.request('tree.get', {});
      expect(viewport).toEqual({ width: 1280, height: 720, pixelRatio: 1 });
      expect(find(root, 'conformance-a')).toMatchObject({
        visible: true,
        focusable: true,
        bounds: { width: 200, height: 100 },
        text: 'A',
        role: 'button',
      });
    });

    it('reports keyboard focus moves', async () => {
      const changes: Array<{ from: string | null; to: string | null }> = [];
      const off = session.on('focus.changed', (e) => changes.push(e));
      await page.keyboard.press('Tab');
      await expect
        .poll(async () => (await session.request('focus.get', {})).node?.testId)
        .toBe('conformance-a');
      await page.keyboard.press('Tab');
      await expect
        .poll(async () => (await session.request('focus.get', {})).node?.testId)
        .toBe('conformance-b');
      await expect.poll(() => changes.length).toBeGreaterThanOrEqual(2);
      off();
    });

    it('tracks CSS transitions and fetches, ignoring infinite animations', async () => {
      await expect(session.request('sync.waitForIdle', { timeoutMs: 2000 })).resolves.toEqual({
        idle: true,
        busy: [],
      });
      await session.request('state.apply', { state: 'grow' });
      const busy = await session.request('sync.waitForIdle', { timeoutMs: 50 });
      expect(busy.idle).toBe(false);
      expect(busy.busy).toContainEqual(
        expect.objectContaining({
          kind: 'animation',
          description: 'transition transform on button[data-testid="conformance-a"]',
        }),
      );
      await expect(session.request('sync.waitForIdle', { timeoutMs: 3000 })).resolves.toMatchObject(
        { idle: true },
      );

      await page.evaluate(() => void fetch('/api'));
      const net = await session.request('sync.waitForIdle', { timeoutMs: 50 });
      expect(net.busy).toContainEqual(
        expect.objectContaining({ kind: 'network', description: 'GET /api' }),
      );
      await expect(session.request('sync.waitForIdle', { timeoutMs: 3000 })).resolves.toMatchObject(
        { idle: true },
      );
    });

    it('forwards uncaught errors', async () => {
      const entries: string[] = [];
      const off = session.on('logs.entry', (e) => {
        if (e.kind === 'uncaught') entries.push(e.message);
      });
      await page.evaluate(() => {
        setTimeout(() => {
          throw new Error('kaboom');
        }, 0);
        void Promise.reject(new Error('nope'));
      });
      await expect.poll(() => entries.length).toBe(2);
      expect(entries.join('\n')).toContain('kaboom');
      expect(entries.join('\n')).toContain('Unhandled rejection: Error: nope');
      off();
    });

    it('takes focus from reportFocus() once a JS focus engine reports it', async () => {
      await page.locator('[data-testid="conformance-a"]').focus();
      const changes: Array<{ from: string | null; to: string | null }> = [];
      const off = session.on('focus.changed', (e) => changes.push(e));
      await session.request('state.apply', { state: 'js-engine' });
      const focusedTestId = async () => (await session.request('focus.get', {})).node?.testId;
      await expect.poll(focusedTestId).toBe('tile-0');
      await page.keyboard.press('ArrowRight');
      await expect.poll(focusedTestId).toBe('tile-1');
      // DOM focus is still on the button: reported focus is the only source now.
      expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe(
        'conformance-a',
      );
      const { root } = await session.request('tree.get', {});
      expect(find(root, 'tile-1')?.focused).toBe(true);
      expect(find(root, 'conformance-a')?.focused).toBe(false);
      await expect.poll(() => changes.at(-1)?.to).toBe(find(root, 'tile-1')?.id);
      off();
    });

    it('exposes <video> elements as media players', async () => {
      await page.evaluate(() => {
        const v = document.createElement('video');
        v.setAttribute('data-testid', 'player');
        document.body.appendChild(v);
      });
      await expect(session.request('media.get', {})).resolves.toEqual({
        media: { id: 'player', state: 'idle', position: 0, duration: null, rate: 1 },
      });
    });
  });
});
