import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import {
  CONFORMANCE_CHECKS,
  CONFORMANCE_FIXTURE,
  formatConformanceReport,
  runConformance,
  type ConformanceTarget,
} from '../src/conformance/index.js';
import { parseArgs, renderCommand } from '../src/conformance/cli-main.js';
import {
  PROTOCOL_VERSION,
  RpcError,
  RpcErrorCode,
  RpcPeer,
  type LaunchPayload,
  type ProtocolNode,
} from '../src/index.js';

interface Bugs {
  reconnectOnReject?: boolean;
  wrongUnknownMethodCode?: boolean;
  noFocusEvents?: boolean;
}

/** A tiny hand-written SDK + fixture app, used to prove the suite itself. */
function fakeFixtureApp(bugs: Bugs = {}): ConformanceTarget {
  let sockets: WebSocket[] = [];
  const S = CONFORMANCE_FIXTURE.states;
  const ids = CONFORMANCE_FIXTURE.testIds;

  const start = (payload: LaunchPayload, attempt = 0): void => {
    let focused: string | null = null;
    let busyUntil = 0;
    const socket = new WebSocket(payload.sdkUrl as string);
    sockets.push(socket);
    const node = (id: string, extra: Partial<ProtocolNode> = {}): ProtocolNode => ({
      id,
      bounds: { x: 0, y: 0, width: 100, height: 50 },
      visible: true,
      focusable: false,
      focused: focused === id,
      enabled: true,
      selected: false,
      busy: false,
      children: [],
      ...extra,
    });
    const tree = (): ProtocolNode =>
      node('n0', {
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        children: [
          node('n1', { testId: ids.a, focusable: true }),
          node('n2', { testId: ids.b, focusable: true }),
          node('n3', { testId: ids.text, text: CONFORMANCE_FIXTURE.text }),
        ],
      });
    const find = (root: ProtocolNode, id: string): ProtocolNode | undefined =>
      root.id === id ? root : root.children.map((c) => find(c, id)).find(Boolean);
    const focus = (id: string) => {
      const from = focused;
      focused = id;
      if (!bugs.noFocusEvents) peer.notify('focus.changed', { from, to: id });
    };
    const applyState = (state: string | undefined, flags: Record<string, unknown> = {}) => {
      if (state === S.focusA) focus('n1');
      else if (state === S.focusB) focus('n2');
      else if (state === S.log)
        peer.notify('logs.entry', { level: 'info', message: String(flags.marker), timestamp: Date.now(), kind: 'console' });
      else if (state === S.busy) busyUntil = Date.now() + Number(flags.ms);
      else if (state === S.fail) throw new RpcError(RpcErrorCode.HandlerFailed, 'fixture failure');
    };
    const peer = new RpcPeer({
      send: (d) => socket.send(d),
      onRequest: async (method, params) => {
        const p = (params ?? {}) as Record<string, unknown>;
        switch (method) {
          case 'tree.get': {
            const root = p.rootId ? find(tree(), String(p.rootId)) : tree();
            if (!root) throw new RpcError(RpcErrorCode.NotFound, 'no such node');
            return { root, viewport: { width: 1920, height: 1080 } };
          }
          case 'focus.get':
            return { node: focused ? (find(tree(), focused) ?? null) : null };
          case 'focus.graph':
            return { nodes: [{ id: 'n1', right: 'n2', left: null }, { id: 'n2', left: 'n1' }] };
          case 'sync.waitForIdle': {
            const end = Date.now() + Number(p.timeoutMs);
            while (Date.now() < busyUntil && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
            const idle = Date.now() >= busyUntil;
            return { idle, busy: idle ? [] : [{ kind: 'custom', description: 'fixture busy' }] };
          }
          case 'media.get':
            return { media: p.id && p.id !== 'main' ? null : { id: 'main', state: 'paused', position: 0, duration: 10, rate: 1 } };
          case 'media.list':
            return { media: [{ id: 'main', state: 'paused', position: 0, duration: 10, rate: 1 }] };
          case 'state.apply':
            applyState(p.state as string | undefined, p.flags as Record<string, unknown>);
            return {};
          default:
            if (method.includes('.') && ['metrics'].includes(method.split('.')[0] as string))
              throw new RpcError(RpcErrorCode.DomainUnavailable, 'nope');
            throw new RpcError(bugs.wrongUnknownMethodCode ? RpcErrorCode.InternalError : RpcErrorCode.MethodNotFound, 'nope');
        }
      },
    });
    socket.on('message', (d) => peer.receive(d.toString()));
    socket.on('error', () => {});
    socket.on('open', () => {
      peer
        .request(
          'dpad.hello',
          {
            protocol: PROTOCOL_VERSION,
            token: payload.token,
            sdk: 'fake@0',
            framework: 'test',
            domains: ['tree', 'focus', 'sync', 'media', 'state', 'logs'],
          },
          2000,
        )
        .then(
          () => applyState(payload.state),
          () => {
            socket.close();
            if (bugs.reconnectOnReject && attempt < 2) setTimeout(() => start(payload, attempt + 1), 100);
          },
        );
    });
    socket.on('close', () => peer.close(new Error('closed')));
  };

  return {
    name: 'fake fixture app',
    fixture: true,
    launch: ({ payload }) => start(payload),
    terminate: () => {
      for (const s of sockets) s.terminate();
      sockets = [];
    },
  };
}

describe('conformance suite', () => {
  it('passes a conforming implementation', { timeout: 30_000 }, async () => {
    const report = await runConformance(fakeFixtureApp(), { connectTimeoutMs: 3000 });
    const text = formatConformanceReport(report);
    expect(report.passed, text).toBe(true);
    expect(report.results.map((r) => r.id)).toEqual(CONFORMANCE_CHECKS);
    // The fake announces every domain, so there is nothing to probe for -32003.
    expect(report.results.filter((r) => r.status === 'skip').map((r) => r.id)).toEqual(['rpc.domain-unavailable']);
    expect(text).toContain('SDK fake@0 (test)');
  });

  it('detects broken implementations', { timeout: 30_000 }, async () => {
    const report = await runConformance(
      fakeFixtureApp({ reconnectOnReject: true, wrongUnknownMethodCode: true, noFocusEvents: true }),
      { connectTimeoutMs: 3000, only: ['rpc.unknown-method', 'fixture.focus', 'handshake.unauthorized'] },
    );
    expect(report.passed).toBe(false);
    expect(Object.fromEntries(report.results.map((r) => [r.id, r.status]))).toEqual({
      'rpc.unknown-method': 'fail',
      'fixture.focus': 'fail',
      'handshake.unauthorized': 'fail',
    });
  });

  it('fails every check clearly when the SDK never connects', async () => {
    const report = await runConformance(
      { launch: () => {}, terminate: () => {} },
      { connectTimeoutMs: 100, only: ['tree.shape', 'handshake.incompatible'] },
    );
    expect(report.results.map((r) => [r.id, r.status])).toEqual([
      ['tree.shape', 'fail'],
      ['handshake.incompatible', 'fail'],
    ]);
    expect(report.results[0]?.message).toContain('did not connect');
  });

  it('skips fixture checks for targets without the fixture', async () => {
    const target = { ...fakeFixtureApp(), fixture: false };
    const report = await runConformance(target, { connectTimeoutMs: 3000, only: ['fixture.'] });
    expect(report.results.every((r) => r.status === 'skip')).toBe(true);
  });
});

describe('dpad-conformance CLI', () => {
  it('parses arguments', () => {
    expect(parseArgs(['--launch', 'node app.js {payload}', '--fixture', '--only', 'tree.', '--timeout', '500'])).toEqual({
      launch: 'node app.js {payload}',
      terminate: undefined,
      fixture: true,
      name: undefined,
      only: ['tree.'],
      connectTimeoutMs: 500,
    });
    expect(() => parseArgs([])).toThrow(/--launch is required/);
    expect(() => parseArgs(['--launch'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--launch', 'x', '--bogus'])).toThrow(/Unknown argument/);
  });

  it('renders the payload placeholder', () => {
    expect(renderCommand('run {payload} {payload}', { payload: { v: 1 }, encoded: 'abc' })).toBe('run abc abc');
  });
});
