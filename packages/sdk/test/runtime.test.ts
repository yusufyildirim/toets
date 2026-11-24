import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSdkHost } from '@toets/protocol/host';
import { encodeLaunchPayloadParam, RpcErrorCode, type ProtocolNode } from '@toets/protocol';
import {
  checkUrl,
  createToets,
  createMediaReporter,
  getToets,
  getLaunchPayload,
  markBusy,
  onState,
  registerMedia,
  reportFocus,
} from '../src/index.js';
import { closeAll, connect, sleep } from './helpers.js';

let server: Server;
let baseUrl: string;
beforeAll(async () => {
  server = createServer((req, res) => {
    const delay = Number(new URL(req.url ?? '/', 'http://x').searchParams.get('delay') ?? 0);
    setTimeout(() => res.end('ok'), delay);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
afterEach(closeAll);

const leaf: ProtocolNode = {
  id: 'n1',
  testId: 'a',
  bounds: { x: 0, y: 0, width: 10, height: 10 },
  visible: true,
  focusable: true,
  focused: false,
  enabled: true,
  selected: false,
  busy: false,
  children: [],
};

describe('inert runtime', () => {
  it.each([undefined, null, '', 'garbage', { v: 1 }, { v: 1, mockUrl: 'http://x' }])(
    'does nothing without a valid payload with sdkUrl (%#)',
    (payload) => {
      const fetchBefore = globalThis.fetch;
      const timeoutBefore = globalThis.setTimeout;
      const logBefore = console.log;
      const toets = createToets({ framework: 'test', payload });
      expect(toets.active).toBe(false);
      expect(toets.status).toBe('inert');
      toets.start();
      expect(toets.status).toBe('inert');
      expect(globalThis.fetch).toBe(fetchBefore);
      expect(globalThis.setTimeout).toBe(timeoutBefore);
      expect(console.log).toBe(logBefore);
      expect(toets.markBusy('x')).toBeTypeOf('function');
      let called = false;
      toets.onState(() => {
        called = true;
      });
      expect(called).toBe(false);
    },
  );

  it('exposes a payload without sdkUrl through getLaunchPayload (black-box mocking)', () => {
    const payload = {
      v: 1 as const,
      mockUrl: 'http://localhost:9400',
      state: 's',
      flags: { a: true },
    };
    const toets = createToets({ framework: 'test', payload: encodeLaunchPayloadParam(payload) });
    expect(toets.active).toBe(false);
    expect(getToets()).not.toBe(toets);
    expect(getLaunchPayload()).toEqual(payload);
    // A later lookup that finds nothing keeps what was found.
    createToets({ framework: 'test', payload: undefined });
    expect(getLaunchPayload()).toEqual(payload);
  });

  it('refuses non-loopback hosts unless allowed', () => {
    expect(checkUrl('ws://localhost:1', false)).toBeNull();
    expect(checkUrl('ws://127.0.0.1:1/x', false)).toBeNull();
    expect(checkUrl('ws://[::1]:1', false)).toBeNull();
    expect(checkUrl('ws://10.0.2.2:1', false)).toBeNull();
    expect(checkUrl('ws://evil.example:1', false)).toMatch(/not loopback/);
    expect(checkUrl('ws://evil.example:1', true)).toBeNull();
    expect(checkUrl('http://localhost:1', false)).toMatch(/not a ws/);
  });

  it('fails without connecting when the payload host is remote', () => {
    const toets = createToets({
      framework: 'test',
      payload: { v: 1, sdkUrl: 'ws://evil.example:1', token: 't' },
    });
    toets.start();
    expect(toets.status).toBe('failed');
  });
});

describe('connected runtime', () => {
  it('accepts the base64url payload and announces domains', async () => {
    const host = await createSdkHost();
    try {
      const token = host.issueToken();
      const toets = createToets({
        framework: 'test',
        payload: encodeLaunchPayloadParam({ v: 1, sdkUrl: host.url, token }),
      });
      toets.handle('tree.get', () => ({ root: leaf, viewport: { width: 100, height: 100 } }));
      toets.start();
      const session = await host.waitForSession(token, { timeoutMs: 5000 });
      expect(session.hello.framework).toBe('test');
      expect(session.hello.sdk).toMatch(/^@toets\/sdk@/);
      expect([...session.domains]).toEqual(['tree', 'sync', 'media', 'state', 'logs']);
      await expect(session.request('tree.get', {})).resolves.toMatchObject({ root: { id: 'n1' } });
      expect(toets.status).toBe('connected');
      expect(getToets()).toBe(toets);
      toets.stop();
    } finally {
      await host.close();
    }
  });

  it('announces focus only with tree and focus handlers', async () => {
    const { session } = await connect({
      logs: false,
      setup: (d) => {
        d.handle('tree.get', () => ({ root: leaf, viewport: { width: 1, height: 1 } }));
        d.handle('focus.get', () => ({ node: null }));
      },
    });
    expect([...session.domains]).toEqual(['tree', 'focus', 'sync', 'media', 'state']);
  });

  it('answers unknown methods and unavailable domains with the right codes', async () => {
    const { session } = await connect();
    await expect(session.request('tree.get', {})).rejects.toMatchObject({
      code: 'sdk.method-unsupported',
    });
    const raw = session as unknown as { requestRaw(m: string, p: unknown): Promise<unknown> };
    await expect(raw.requestRaw('tree.get', {})).rejects.toMatchObject({
      rpcCode: RpcErrorCode.DomainUnavailable,
    });
    await expect(raw.requestRaw('nope.nope', {})).rejects.toMatchObject({
      rpcCode: RpcErrorCode.MethodNotFound,
    });
    await expect(raw.requestRaw('sync.waitForIdle', { timeoutMs: 'x' })).rejects.toMatchObject({
      rpcCode: RpcErrorCode.InvalidParams,
    });
  });

  it('reports idle, and names custom, timer and network work while busy', async () => {
    const { session, toets } = await connect();
    await expect(session.request('sync.waitForIdle', { timeoutMs: 1000 })).resolves.toEqual({
      idle: true,
      busy: [],
    });

    const done = markBusy('hero image');
    const busy = await session.request('sync.waitForIdle', { timeoutMs: 50 });
    expect(busy.idle).toBe(false);
    expect(busy.busy).toEqual([
      expect.objectContaining({ kind: 'custom', description: 'hero image' }),
    ]);
    done();

    setTimeout(() => {}, 300);
    setTimeout(() => {}, 5000); // long timers are not tracked
    const timer = await session.request('sync.waitForIdle', { timeoutMs: 50 });
    expect(timer.busy).toEqual([
      expect.objectContaining({ kind: 'timer', description: 'setTimeout 300ms' }),
    ]);
    await expect(session.request('sync.waitForIdle', { timeoutMs: 2000 })).resolves.toMatchObject({
      idle: true,
    });

    const request = fetch(`${baseUrl}/api/home?delay=300`);
    const network = await session.request('sync.waitForIdle', { timeoutMs: 50 });
    // (The in-process test server's own delay timer shows up too.)
    expect(network.busy).toContainEqual(
      expect.objectContaining({
        kind: 'network',
        description: `GET ${baseUrl}/api/home?delay=300`,
      }),
    );
    await request;
    await expect(session.request('sync.waitForIdle', { timeoutMs: 2000 })).resolves.toMatchObject({
      idle: true,
    });

    toets.idle.untracked(() => setTimeout(() => {}, 300));
    await expect(session.request('sync.waitForIdle', { timeoutMs: 1000 })).resolves.toMatchObject({
      idle: true,
    });
  });

  it('honors ignore rules', async () => {
    // 'setTimeout' hides the in-process test server's own delay timers.
    const { session } = await connect({ idle: { ignore: ['/poll', /beacon/, 'setTimeout'] } });
    const a = fetch(`${baseUrl}/poll?delay=200`);
    const b = fetch(`${baseUrl}/beacon?delay=200`);
    await sleep(20);
    await expect(session.request('sync.waitForIdle', { timeoutMs: 50 })).resolves.toMatchObject({
      idle: true,
    });
    await Promise.all([a, b]);
  });

  it('applies the launch state and state.apply through onState', async () => {
    const seen: Array<[string | undefined, unknown]> = [];
    const off = onState(async (state, flags) => {
      await sleep(50);
      seen.push([state, flags]);
      if (state === 'broken') throw new Error('nope');
    });
    try {
      const { session } = await connect({ extra: { state: 'home', flags: { beta: true } } });
      await expect(session.request('sync.waitForIdle', { timeoutMs: 2000 })).resolves.toMatchObject(
        { idle: true },
      );
      expect(seen).toEqual([['home', { beta: true }]]);
      await expect(
        session.request('state.apply', { state: 'details', flags: {} }),
      ).resolves.toEqual({});
      expect(seen.at(-1)).toEqual(['details', {}]);
      await expect(session.request('state.apply', { state: 'broken' })).rejects.toMatchObject({
        rpcCode: RpcErrorCode.HandlerFailed,
        message: expect.stringContaining('nope'),
      });
    } finally {
      off();
    }
  });

  it('fails state.apply clearly without handlers', async () => {
    const { session } = await connect();
    await expect(session.request('state.apply', { state: 'x' })).rejects.toMatchObject({
      rpcCode: RpcErrorCode.HandlerFailed,
      message: expect.stringContaining('No onState handler'),
    });
  });

  it('forwards console output, including lines logged before the handshake', async () => {
    const host = await createSdkHost();
    const token = host.issueToken();
    const toets = createToets({ framework: 'test', payload: { v: 1, sdkUrl: host.url, token } });
    try {
      console.info('before %s', 'start', { a: 1 });
      toets.start();
      const session = await host.waitForSession(token, { timeoutMs: 5000 });
      const entries: string[] = [];
      session.on('logs.entry', (e) => entries.push(`${e.level}:${e.message}`));
      console.warn('after', new Error('boom').message);
      await sleep(100);
      expect(entries).toEqual(['info:before start {"a":1}', 'warn:after boom']);
    } finally {
      toets.stop();
      await host.close();
    }
  });

  it('serves media players and emits media.changed on state changes', async () => {
    const pull = registerMedia('pull', {
      getSnapshot: () => ({ state: 'paused', position: 3, duration: 10, rate: 1 }),
    });
    const media = createMediaReporter('push');
    try {
      const { session } = await connect();
      const changes: string[] = [];
      session.on('media.changed', (m) => changes.push(`${m.id}:${m.state}`));
      media.update({ state: 'playing', duration: 60 });
      media.update({ position: 1 }); // position progress is not a change
      media.update({ state: 'paused' });
      await sleep(100);
      // Registration announces the initial state (queued until the handshake).
      expect(changes).toEqual(['pull:paused', 'push:idle', 'push:playing', 'push:paused']);
      const list = await session.request('media.list', {});
      expect(list.media.map((m) => m.id).sort()).toEqual(['pull', 'push']);
      await expect(session.request('media.get', { id: 'pull' })).resolves.toEqual({
        media: { id: 'pull', state: 'paused', position: 3, duration: 10, rate: 1 },
      });
      media.update({ state: 'playing' });
      await expect(session.request('media.get', {})).resolves.toMatchObject({
        media: { id: 'push' },
      });
      await expect(session.request('media.get', { id: 'none' })).resolves.toEqual({ media: null });
    } finally {
      pull();
      media.dispose();
    }
  });

  it('emits deduplicated focus.changed from the focus source', async () => {
    let focused: string | null = 'n1';
    const { session, toets } = await connect({
      setup: (d) => {
        d.handle('tree.get', () => ({ root: leaf, viewport: { width: 1, height: 1 } }));
        d.handle('focus.get', () => ({ node: null }));
        d.setFocusSource({ current: () => focused });
      },
    });
    const events: unknown[] = [];
    session.on('focus.changed', (e) => events.push(e));
    focused = 'n2';
    toets.focusChanged();
    toets.focusChanged();
    await sleep(50);
    toets.focusChanged();
    await sleep(50);
    expect(events).toEqual([{ from: 'n1', to: 'n2' }]);
  });

  it('switches to reported focus on the first reportFocus() call', async () => {
    const { session, toets } = await connect({
      setup: (d) => {
        d.handle('tree.get', () => ({ root: leaf, viewport: { width: 1, height: 1 } }));
        d.handle('focus.get', () => ({ node: null }));
        // How adapters resolve focus: reported once the app reports, the platform's before.
        d.setFocusSource({
          current: () => (d.reportedFocus ? (d.reportedFocus.target as string | null) : 'native'),
        });
      },
    });
    const events: unknown[] = [];
    session.on('focus.changed', (e) => events.push(e));
    expect(toets.reportedFocus).toBeNull();
    reportFocus('card-1');
    await sleep(20);
    reportFocus(null);
    await sleep(20);
    expect(toets.reportedFocus).toEqual({ target: null });
    expect(events).toEqual([
      { from: 'native', to: 'card-1' },
      { from: 'card-1', to: null },
    ]);
  });

  it('replays focus reported before the runtime exists', async () => {
    vi.resetModules();
    const sdk = await import('../src/index.js');
    sdk.reportFocus('early');
    const toets = sdk.createToets({
      framework: 'test',
      payload: { v: 1, sdkUrl: 'ws://localhost:1', token: 't' },
    });
    expect(toets.reportedFocus).toEqual({ target: 'early' });
    toets.stop();
  });

  it('stops and restores hooks when the host closes the session', async () => {
    const fetchBefore = globalThis.fetch;
    const { session, toets } = await connect();
    expect(globalThis.fetch).not.toBe(fetchBefore);
    await session.close();
    await sleep(50);
    expect(toets.status).toBe('closed');
    expect(globalThis.fetch).toBe(fetchBefore);
  });

  it('goes inert after a rejected handshake without reconnecting', async () => {
    const events: string[] = [];
    const host = await createSdkHost({ onEvent: (e) => events.push(e.type) });
    try {
      const toets = createToets({
        framework: 'test',
        payload: { v: 1, sdkUrl: host.url, token: 'wrong' },
      });
      toets.start();
      await sleep(800);
      expect(toets.status).toBe('rejected');
      expect(events).toEqual(['connection', 'rejected']);
    } finally {
      await host.close();
    }
  });

  it('retries while the host is unreachable, then fails', async () => {
    const host = await createSdkHost();
    const url = host.url;
    await host.close();
    const toets = createToets({
      framework: 'test',
      payload: { v: 1, sdkUrl: url, token: 't' },
      connectRetries: 2,
    });
    toets.start();
    expect(toets.status).toBe('connecting');
    await sleep(1500);
    expect(toets.status).toBe('failed');
  });
});

describe('core runtime conformance (no adapter)', () => {
  it('passes the suite for the domains it announces', { timeout: 60_000 }, async () => {
    const { runConformance, formatConformanceReport } = await import('@toets/protocol/conformance');
    let toets: ReturnType<typeof createToets> | undefined;
    const report = await runConformance(
      {
        name: 'core runtime in Node',
        launch: ({ encoded }) => {
          toets = createToets({ framework: 'node', payload: encoded });
          toets.start();
        },
        terminate: () => toets?.stop(),
      },
      { connectTimeoutMs: 5000 },
    );
    expect(report.passed, formatConformanceReport(report)).toBe(true);
    expect(report.results.find((r) => r.id === 'rpc.domain-unavailable')?.status).toBe('pass');
  });
});

describe('noop module', () => {
  it('mirrors the app-facing API without doing anything', async () => {
    const noop = await import('../src/noop.js');
    const toets = noop.startToets();
    expect(toets.status).toBe('inert');
    expect(toets.active).toBe(false);
    expect(noop.getToets()).toBeNull();
    expect(noop.getLaunchPayload()).toBeNull();
    noop.markBusy('x')();
    noop.onState(() => {})();
    noop.createMediaReporter('m').update({ state: 'playing' });
    noop.reportFocus(null);
  });
});
