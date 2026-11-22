import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright-core';
import { encodeLaunchPayloadParam, type ProtocolNode } from '@dpad-tv/protocol';
import { createSdkHost, type SdkHost, type SdkSession } from '@dpad-tv/protocol/host';
import { formatConformanceReport, runConformance } from '@dpad-tv/protocol/conformance';
import { bundleFixture, launchChromium, serveApp } from './chromium.js';

let browser: Browser;
let app: { url: string; close: () => Promise<void> };

beforeAll(async () => {
  app = await serveApp(await bundleFixture('./fixtures/conformance-app.ts'));
  browser = await launchChromium();
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await app?.close();
});

describe('web adapter in Chromium', () => {
  it('passes the protocol conformance suite', { timeout: 120_000 }, async () => {
    let page: Page | undefined;
    const report = await runConformance({
      name: '@dpad-tv/sdk/web in Chromium',
      fixture: true,
      launch: async ({ encoded }) => {
        page = await browser.newPage();
        await page.goto(`${app.url}/?__dpad=${encoded}`);
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
        `${app.url}/?__dpad=${encodeLaunchPayloadParam({ v: 1, sdkUrl: host.url, token })}`,
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
