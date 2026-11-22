import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { CloseCode, RpcError, RpcErrorCode, type ProtocolNode } from '../src/index.js';
import { createSdkHost, type SdkHost, type SdkHostEvent } from '../src/server/index.js';
import { connectFakeApp, sleep } from './helpers.js';

const node: ProtocolNode = {
  id: 'root',
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  visible: true,
  focusable: false,
  focused: false,
  enabled: true,
  selected: false,
  busy: false,
  children: [],
};

let host: SdkHost | undefined;
afterEach(async () => {
  await host?.close();
  host = undefined;
});

async function start(opts: Parameters<typeof createSdkHost>[0] = {}) {
  const events: SdkHostEvent[] = [];
  host = await createSdkHost({ ...opts, onEvent: (e) => events.push(e) });
  return { host, events };
}

describe('SdkHost', () => {
  it('listens on localhost and completes the handshake', async () => {
    const { host, events } = await start();
    expect(host.url).toBe(`ws://localhost:${host.port}`);
    const token = host.issueToken();
    const waiting = host.waitForSession(token, { timeoutMs: 2000 });
    const app = await connectFakeApp(host.url, { token });
    const result = (await app.hello()) as { protocol: string; sessionId: string };
    const session = await waiting;
    expect(result.protocol).toBe('1.0.0');
    expect(result.sessionId).toBe(session.id);
    expect(session.hello.sdk).toBe('fake-sdk@0.0.0');
    expect([...session.domains]).toEqual(['tree', 'sync', 'logs']);
    expect(events.map((e) => e.type)).toEqual(['connection', 'session']);
  });

  it('accepts IPv4 and IPv6 loopback clients', async () => {
    const { host } = await start();
    for (const address of ['127.0.0.1', '[::1]']) {
      const token = host.issueToken();
      const app = await connectFakeApp(`ws://${address}:${host.port}`, { token });
      await app.hello();
      await host.waitForSession(token, { timeoutMs: 1000 });
      app.socket.close();
    }
  });

  it('resolves a session that connected before waitForSession was called', async () => {
    const { host } = await start();
    const token = host.issueToken();
    const app = await connectFakeApp(host.url, { token });
    await app.hello();
    const session = await host.waitForSession(token, { timeoutMs: 100 });
    expect(session.hello.framework).toBe('test');
  });

  it('ignores unknown domains announced by newer SDKs', async () => {
    const { host } = await start();
    const token = host.issueToken();
    const app = await connectFakeApp(host.url, { token });
    await app.hello({ domains: ['tree', 'future' as never] });
    const session = await host.waitForSession(token, { timeoutMs: 1000 });
    expect([...session.domains]).toEqual(['tree']);
  });

  it('rejects unknown and reused tokens with Unauthorized', async () => {
    const { host, events } = await start();
    const bad = await connectFakeApp(host.url, { token: 'nope' });
    await expect(bad.hello()).rejects.toMatchObject({ code: RpcErrorCode.Unauthorized });
    expect((await bad.closed).code).toBe(CloseCode.Unauthorized);

    const token = host.issueToken();
    const first = await connectFakeApp(host.url, { token });
    await first.hello();
    const second = await connectFakeApp(host.url, { token });
    await expect(second.hello()).rejects.toMatchObject({ code: RpcErrorCode.Unauthorized });
    expect(events.filter((e) => e.type === 'rejected').map((e) => e.type === 'rejected' && e.reason)).toEqual([
      'unauthorized',
      'unauthorized',
    ]);
  });

  it('rejects an incompatible protocol major', async () => {
    const { host } = await start();
    const token = host.issueToken();
    const app = await connectFakeApp(host.url, { token });
    const error = (await app.hello({ protocol: '2.0.0' }).catch((e: unknown) => e)) as RpcError;
    expect(error.code).toBe(RpcErrorCode.IncompatibleProtocol);
    expect(error.data).toEqual({ protocol: '1.0.0' });
    expect((await app.closed).code).toBe(CloseCode.IncompatibleProtocol);
  });

  it('rejects a first message that is not dpad.hello', async () => {
    const { host } = await start();
    const app = await connectFakeApp(host.url);
    await expect(app.peer.request('tree.get', {}, 1000)).rejects.toMatchObject({
      code: RpcErrorCode.InvalidRequest,
    });
    expect((await app.closed).code).toBe(CloseCode.HandshakeFailed);
  });

  it('rejects an invalid hello with InvalidParams', async () => {
    const { host } = await start();
    const token = host.issueToken();
    const app = await connectFakeApp(host.url, { token });
    await expect(app.hello({ domains: 'tree' as never })).rejects.toMatchObject({
      code: RpcErrorCode.InvalidParams,
    });
  });

  it('closes connections that never say hello', async () => {
    const { host } = await start({ handshakeTimeoutMs: 50 });
    const app = await connectFakeApp(host.url);
    expect((await app.closed).code).toBe(CloseCode.HandshakeFailed);
  });

  it('explains session timeouts, including rejected attempts', async () => {
    const { host } = await start();
    const token = host.issueToken();
    await expect(host.waitForSession(token, { timeoutMs: 30 })).rejects.toMatchObject({
      code: 'sdk.session-timeout',
      message: expect.stringContaining('No connection attempt'),
    });
    const waiting = host.waitForSession(token, { timeoutMs: 300 });
    const app = await connectFakeApp(host.url, { token: 'wrong' });
    await app.hello().catch(() => {});
    await expect(waiting).rejects.toMatchObject({
      code: 'sdk.session-timeout',
      message: expect.stringContaining('unauthorized'),
    });
    await expect(host.waitForSession('never-issued', { timeoutMs: 10 })).rejects.toMatchObject({
      code: 'sdk.unknown-token',
    });
  });

  it('sends requests and maps responses, errors and timeouts', async () => {
    const { host } = await start({ requestTimeoutMs: 100 });
    const token = host.issueToken();
    const app = await connectFakeApp(host.url, {
      token,
      onRequest: (method, params) => {
        if (method === 'tree.get') {
          if ((params as { rootId?: string }).rootId) throw new RpcError(RpcErrorCode.NotFound, 'no node');
          return { root: node, viewport: { width: 1920, height: 1080 } };
        }
        if (method === 'sync.waitForIdle') return new Promise(() => {});
        return null;
      },
    });
    await app.hello();
    const session = await host.waitForSession(token, { timeoutMs: 1000 });
    expect(session.has('tree.get')).toBe(true);
    expect(session.has('media.get')).toBe(false);

    await expect(session.request('tree.get', {})).resolves.toEqual({
      root: node,
      viewport: { width: 1920, height: 1080 },
    });
    await expect(session.request('tree.get', { rootId: 'x' })).rejects.toMatchObject({
      code: 'sdk.remote-error',
      rpcCode: RpcErrorCode.NotFound,
    });
    await expect(session.request('media.get', {})).rejects.toMatchObject({
      code: 'sdk.method-unsupported',
    });
    await expect(session.request('sync.waitForIdle', { timeoutMs: 0 }, { timeoutMs: 30 })).rejects.toMatchObject({
      code: 'sdk.request-timeout',
    });
  });

  it('extends the default timeout of sync.waitForIdle by its own timeout', async () => {
    const { host } = await start({ requestTimeoutMs: 50 });
    const token = host.issueToken();
    const app = await connectFakeApp(host.url, {
      token,
      onRequest: async () => {
        await sleep(150);
        return { idle: true, busy: [] };
      },
    });
    await app.hello();
    const session = await host.waitForSession(token, { timeoutMs: 1000 });
    await expect(session.request('sync.waitForIdle', { timeoutMs: 200 })).resolves.toEqual({
      idle: true,
      busy: [],
    });
  });

  it('buffers notifications until the first listener subscribes', async () => {
    const { host } = await start();
    const token = host.issueToken();
    const app = await connectFakeApp(host.url, { token });
    await app.hello();
    const session = await host.waitForSession(token, { timeoutMs: 1000 });
    app.peer.notify('logs.entry', { level: 'info', message: 'early', timestamp: 1 });
    app.peer.notify('unknown.notification', {});
    await sleep(30);
    const seen: string[] = [];
    session.on('logs.entry', (e) => seen.push(e.message));
    await sleep(0);
    app.peer.notify('logs.entry', { level: 'info', message: 'late', timestamp: 2 });
    await sleep(30);
    expect(seen).toEqual(['early', 'late']);
  });

  it('answers app requests after the handshake with MethodNotFound', async () => {
    const { host } = await start();
    const token = host.issueToken();
    const app = await connectFakeApp(host.url, { token });
    await app.hello();
    await expect(app.peer.request('host.something', {}, 1000)).rejects.toMatchObject({
      code: RpcErrorCode.MethodNotFound,
    });
    await expect(app.hello()).rejects.toMatchObject({ code: RpcErrorCode.InvalidRequest });
  });

  it('rejects pending requests and resolves closed when the app disconnects', async () => {
    const { host } = await start();
    const token = host.issueToken();
    const app = await connectFakeApp(host.url, { token, onRequest: () => new Promise(() => {}) });
    await app.hello();
    const session = await host.waitForSession(token, { timeoutMs: 1000 });
    const pending = session.request('tree.get', {});
    app.socket.close();
    await expect(pending).rejects.toMatchObject({ code: 'sdk.closed' });
    await session.closed;
  });

  it('closes sessions cleanly from the host side', async () => {
    const { host, events } = await start();
    const token = host.issueToken();
    const app = await connectFakeApp(host.url, { token });
    await app.hello();
    const session = await host.waitForSession(token, { timeoutMs: 1000 });
    await session.close();
    expect((await app.closed).code).toBe(CloseCode.Normal);
    expect(events.at(-1)).toMatchObject({ type: 'session-closed', code: CloseCode.Normal });
  });

  it('terminates sessions that stop answering heartbeats', async () => {
    const { host, events } = await start({ heartbeatIntervalMs: 30 });
    const token = host.issueToken();
    const app = await connectFakeApp(host.url, { token, autoPong: false });
    await app.hello();
    const session = await host.waitForSession(token, { timeoutMs: 1000 });
    await session.closed;
    expect(events.at(-1)).toMatchObject({ type: 'session-closed', code: CloseCode.Unresponsive });
  });

  it('rejects waiters and closes sessions on host close', async () => {
    const { host } = await start();
    const waiting = host.waitForSession(host.issueToken(), { timeoutMs: 5000 }).catch((e: unknown) => e);
    const token = host.issueToken();
    const app = await connectFakeApp(host.url, { token });
    await app.hello();
    await host.close();
    expect(await waiting).toMatchObject({ code: 'sdk.host-closed' });
    expect((await app.closed).code).toBe(CloseCode.GoingAway);
    await expect(host.waitForSession('x', { timeoutMs: 10 })).rejects.toMatchObject({
      code: 'sdk.host-closed',
    });
  });

  it('answers plain HTTP with 426', async () => {
    const { host } = await start();
    const res = await fetch(`http://127.0.0.1:${host.port}/`);
    expect(res.status).toBe(426);
  });

  it('fails clearly when the port is taken', async () => {
    const { host } = await start();
    await expect(createSdkHost({ port: host.port })).rejects.toMatchObject({
      code: 'sdk.listen-failed',
    });
    void WebSocket;
  });
});
