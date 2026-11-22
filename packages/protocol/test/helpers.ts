import WebSocket from 'ws';
import { PROTOCOL_VERSION, RpcPeer, type HelloParams } from '../src/index.js';

export interface FakeApp {
  readonly socket: WebSocket;
  readonly peer: RpcPeer;
  /** Resolves with `{ code, reason }` when the socket closes. */
  readonly closed: Promise<{ code: number; reason: string }>;
  hello(overrides?: Partial<HelloParams>): Promise<unknown>;
}

/** A minimal hand-written SDK used to drive the host in tests. */
export async function connectFakeApp(
  url: string,
  opts: {
    token?: string;
    onRequest?: (method: string, params: unknown) => unknown;
    autoPong?: boolean;
  } = {},
): Promise<FakeApp> {
  const socket = new WebSocket(url, { autoPong: opts.autoPong ?? true });
  const peer = new RpcPeer({
    send: (data) => socket.send(data),
    onRequest: opts.onRequest ?? (() => null),
  });
  socket.on('message', (data) => peer.receive(data.toString()));
  const closed = new Promise<{ code: number; reason: string }>((resolve) =>
    socket.on('close', (code, reason) => {
      peer.close(new Error('closed'));
      resolve({ code, reason: reason.toString() });
    }),
  );
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return {
    socket,
    peer,
    closed,
    hello: (overrides = {}) =>
      peer.request(
        'dpad.hello',
        {
          protocol: PROTOCOL_VERSION,
          token: opts.token ?? '',
          sdk: 'fake-sdk@0.0.0',
          framework: 'test',
          domains: ['tree', 'sync', 'logs'],
          ...overrides,
        },
        2000,
      ),
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
