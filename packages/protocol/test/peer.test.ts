import { describe, expect, it } from 'vitest';
import { RpcError, RpcErrorCode, RpcPeer, RpcTimeoutError } from '../src/index.js';

function pair(handlers: { onRequest?: (m: string, p: unknown) => unknown } = {}) {
  const sentByA: string[] = [];
  const notifications: Array<[string, unknown]> = [];
  // eslint-disable-next-line prefer-const
  let b: RpcPeer;
  const a = new RpcPeer({
    send: (data) => {
      sentByA.push(data);
      queueMicrotask(() => b.receive(data));
    },
  });
  b = new RpcPeer({
    send: (data) => queueMicrotask(() => a.receive(data)),
    onRequest: handlers.onRequest ?? (() => null),
    onNotification: (m, p) => notifications.push([m, p]),
  });
  return { a, b, sentByA, notifications };
}

describe('RpcPeer', () => {
  it('correlates concurrent requests and responses', async () => {
    const { a } = pair({
      onRequest: async (method, params) => {
        await new Promise((r) => setTimeout(r, method === 'slow' ? 20 : 1));
        return { method, params };
      },
    });
    const [slow, fast] = await Promise.all([
      a.request('slow', 1, 1000),
      a.request('fast', 2, 1000),
    ]);
    expect(slow).toEqual({ method: 'slow', params: 1 });
    expect(fast).toEqual({ method: 'fast', params: 2 });
  });

  it('maps handler errors to error responses', async () => {
    const { a } = pair({
      onRequest: (method) => {
        if (method === 'specific') throw new RpcError(RpcErrorCode.NotFound, 'gone', { id: 'x' });
        throw new Error('boom');
      },
    });
    await expect(a.request('specific', {}, 1000)).rejects.toMatchObject({
      code: RpcErrorCode.NotFound,
      message: 'gone',
      data: { id: 'x' },
    });
    await expect(a.request('other', {}, 1000)).rejects.toMatchObject({
      code: RpcErrorCode.InternalError,
      message: 'boom',
    });
  });

  it('times out', async () => {
    const { a } = pair({ onRequest: () => new Promise(() => {}) });
    await expect(a.request('never', {}, 20)).rejects.toBeInstanceOf(RpcTimeoutError);
  });

  it('delivers notifications', async () => {
    const { a, notifications } = pair();
    a.notify('logs.entry', { message: 'hi' });
    await new Promise((r) => setTimeout(r, 0));
    expect(notifications).toEqual([['logs.entry', { message: 'hi' }]]);
  });

  it('answers malformed input with JSON-RPC errors', () => {
    const out: unknown[] = [];
    const peer = new RpcPeer({ send: (d) => out.push(JSON.parse(d)) });
    peer.receive('{nope');
    peer.receive('[]');
    peer.receive('{"jsonrpc":"1.0","id":3,"method":"x"}');
    peer.receive('{"jsonrpc":"2.0","id":4}');
    peer.receive('{"jsonrpc":"2.0","id":5,"method":"x"}');
    expect(out).toEqual([
      {
        jsonrpc: '2.0',
        id: null,
        error: expect.objectContaining({ code: RpcErrorCode.ParseError }),
      },
      {
        jsonrpc: '2.0',
        id: null,
        error: expect.objectContaining({ code: RpcErrorCode.InvalidRequest }),
      },
      {
        jsonrpc: '2.0',
        id: 3,
        error: expect.objectContaining({ code: RpcErrorCode.InvalidRequest }),
      },
      {
        jsonrpc: '2.0',
        id: 4,
        error: expect.objectContaining({ code: RpcErrorCode.InvalidRequest }),
      },
      {
        jsonrpc: '2.0',
        id: 5,
        error: expect.objectContaining({ code: RpcErrorCode.MethodNotFound }),
      },
    ]);
  });

  it('rejects pending and future requests on close', async () => {
    const { a } = pair({ onRequest: () => new Promise(() => {}) });
    const pending = a.request('x', {}, 1000);
    const reason = new Error('closed');
    a.close(reason);
    await expect(pending).rejects.toBe(reason);
    await expect(a.request('y', {}, 1000)).rejects.toBe(reason);
  });
});
