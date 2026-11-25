import { ProtocolError } from '../errors.js';
import { RpcErrorCode } from '../jsonrpc.js';
import {
  DOMAINS,
  HELLO_METHOD,
  METHOD_DOMAIN,
  NOTIFICATION_DOMAIN,
  PROTOCOL_VERSION,
  type Domain,
  type HelloParams,
  type HostToAppMethod,
  type ProtocolNode,
} from '../messages.js';
import type { Session } from '../server/session.js';
import {
  unknownDomains,
  validateBusyResources,
  validateFocusChanged,
  validateHelloParams,
  validateLogEntry,
  validateMediaInfo,
  validateNodeTree,
  validateViewport,
} from '../validate.js';
import { parseProtocolVersion } from '../version.js';
import { CONFORMANCE_FIXTURE } from '../fixture.js';

export class CheckFailed extends Error {}
export class CheckSkipped extends Error {}

export function fail(message: string): never {
  throw new CheckFailed(message);
}
export function skip(message: string): never {
  throw new CheckSkipped(message);
}
function assertValid(problems: string[], what: string): void {
  if (problems.length > 0) fail(`${what}: ${problems.slice(0, 5).join('; ')}`);
}

export type Scenario = 'session' | 'launch-state' | 'reject-unauthorized' | 'reject-incompatible';

export interface SessionContext {
  readonly session: Session;
  readonly token: string;
  readonly requestTimeoutMs: number;
  readonly notifications: ReadonlyArray<{ method: string; params: unknown }>;
  /** Number of WebSocket connections the host has seen so far. */
  connections(): number;
}

export interface RejectContext {
  readonly token: string;
  readonly firstFrame: string | null;
  readonly connections: number;
}

export interface Check<C> {
  readonly id: string;
  readonly title: string;
  readonly scenario: Scenario;
  readonly domains?: readonly Domain[];
  readonly fixture?: boolean;
  run(ctx: C): Promise<void>;
}

const { testIds, states, text: fixtureText } = CONFORMANCE_FIXTURE;

function flatten(root: ProtocolNode): ProtocolNode[] {
  const out: ProtocolNode[] = [];
  const visit = (n: ProtocolNode): void => {
    out.push(n);
    n.children.forEach(visit);
  };
  visit(root);
  return out;
}

async function getTree(ctx: SessionContext, rootId?: string) {
  const result = (await ctx.session.requestRaw(
    'tree.get',
    rootId === undefined ? {} : { rootId },
    ctx.requestTimeoutMs,
  )) as { root: ProtocolNode; viewport: unknown };
  if (typeof result !== 'object' || result === null) fail('tree.get result must be an object');
  return result;
}

async function rpcCodeOf(promise: Promise<unknown>): Promise<number | 'ok'> {
  try {
    await promise;
    return 'ok';
  } catch (error) {
    if (error instanceof ProtocolError && error.rpcCode !== undefined) return error.rpcCode;
    throw error;
  }
}

async function apply(
  ctx: SessionContext,
  state: string,
  flags?: Record<string, string | number | boolean>,
) {
  return ctx.session.requestRaw(
    'state.apply',
    flags ? { state, flags } : { state },
    ctx.requestTimeoutMs,
  );
}

async function waitIdle(ctx: SessionContext, timeoutMs: number) {
  if (!ctx.session.domains.has('sync')) return;
  await ctx.session.requestRaw('sync.waitForIdle', { timeoutMs }, timeoutMs + ctx.requestTimeoutMs);
}

async function focusedTestId(ctx: SessionContext): Promise<string | undefined> {
  const { node } = (await ctx.session.requestRaw('focus.get', {}, ctx.requestTimeoutMs)) as {
    node: ProtocolNode | null;
  };
  return node?.testId;
}

async function eventually(fn: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

function waitForNotification(
  ctx: SessionContext,
  method: string,
  predicate: (params: unknown) => boolean,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new CheckFailed(`no matching ${method} notification within ${timeoutMs}ms`));
    }, timeoutMs);
    const off = ctx.session.onRawNotification((m, params) => {
      if (m === method && predicate(params)) {
        clearTimeout(timer);
        off();
        resolve(params);
      }
    });
  });
}

/** Methods to probe for `DomainUnavailable`, one per domain that has methods. */
function firstMethodOf(domain: Domain): HostToAppMethod | undefined {
  return (Object.keys(METHOD_DOMAIN) as HostToAppMethod[]).find((m) => METHOD_DOMAIN[m] === domain);
}

const PROBE_PARAMS: Readonly<Record<HostToAppMethod, unknown>> = {
  'tree.get': {},
  'focus.get': {},
  'sync.waitForIdle': { timeoutMs: 0 },
  'media.get': {},
  'media.list': {},
  'state.apply': {},
};

export const sessionChecks: Check<SessionContext>[] = [
  {
    id: 'handshake.hello',
    title: 'toets.hello carries the token, a compatible protocol, sdk, framework and domains',
    scenario: 'session',
    async run(ctx) {
      const hello = ctx.session.hello;
      assertValid(validateHelloParams(hello), 'invalid hello');
      if (hello.token !== ctx.token) fail('hello.token does not match the launch payload token');
      const v = parseProtocolVersion(hello.protocol);
      if (v?.major !== parseProtocolVersion(PROTOCOL_VERSION)?.major)
        fail(`protocol ${hello.protocol} is not major ${PROTOCOL_VERSION.split('.')[0]}`);
      if (new Set(hello.domains).size !== hello.domains.length)
        fail('hello.domains has duplicates');
      const unknown = unknownDomains(hello.domains);
      if (unknown.length > 0)
        fail(`unknown domains for protocol ${PROTOCOL_VERSION}: ${unknown.join(', ')}`);
    },
  },
  {
    id: 'handshake.domains',
    title: 'announced domains are coherent (focus requires tree)',
    scenario: 'session',
    async run(ctx) {
      const d = ctx.session.domains;
      if (d.has('focus') && !d.has('tree')) fail('"focus" is announced without "tree"');
      if (d.has('metrics')) fail('"metrics" is reserved in protocol 1.x and must not be announced');
    },
  },
  {
    id: 'rpc.parse-error',
    title: 'answers unparsable frames with -32700 and keeps the connection',
    scenario: 'session',
    async run(ctx) {
      const reply = nextFrame(ctx.session, ctx.requestTimeoutMs);
      ctx.session.sendRaw('{this is not json');
      const msg = JSON.parse(await reply) as Record<string, unknown>;
      const error = msg.error as { code?: unknown } | undefined;
      if (msg.id !== null || error?.code !== RpcErrorCode.ParseError)
        fail(`expected {id: null, error.code: -32700}, got ${JSON.stringify(msg)}`);
      await expectAlive(ctx);
    },
  },
  {
    id: 'rpc.invalid-request',
    title: 'answers invalid requests with -32600',
    scenario: 'session',
    async run(ctx) {
      const reply = nextFrame(ctx.session, ctx.requestTimeoutMs);
      ctx.session.sendRaw(JSON.stringify({ jsonrpc: '2.0', id: 'conformance-invalid' }));
      const msg = JSON.parse(await reply) as Record<string, unknown>;
      const error = msg.error as { code?: unknown } | undefined;
      if (error?.code !== RpcErrorCode.InvalidRequest)
        fail(`expected error.code -32600, got ${JSON.stringify(msg)}`);
      await expectAlive(ctx);
    },
  },
  {
    id: 'rpc.unknown-method',
    title: 'answers unknown methods with -32601',
    scenario: 'session',
    async run(ctx) {
      const code = await rpcCodeOf(
        ctx.session.requestRaw('conformance.noSuchMethod', {}, ctx.requestTimeoutMs),
      );
      if (code !== RpcErrorCode.MethodNotFound) fail(`expected -32601, got ${code}`);
    },
  },
  {
    id: 'rpc.domain-unavailable',
    title: 'answers methods of unannounced domains with -32003',
    scenario: 'session',
    async run(ctx) {
      const missing = DOMAINS.filter((d) => !ctx.session.domains.has(d) && firstMethodOf(d));
      if (missing.length === 0) skip('every domain with methods is announced');
      for (const domain of missing) {
        const method = firstMethodOf(domain) as HostToAppMethod;
        const code = await rpcCodeOf(
          ctx.session.requestRaw(method, PROBE_PARAMS[method], ctx.requestTimeoutMs),
        );
        if (code !== RpcErrorCode.DomainUnavailable)
          fail(`${method}: expected -32003, got ${code}`);
      }
    },
  },
  {
    id: 'rpc.concurrent',
    title: 'answers concurrent requests, matching responses by id',
    scenario: 'session',
    async run(ctx) {
      const methods = (Object.keys(METHOD_DOMAIN) as HostToAppMethod[]).filter(
        (m) => ctx.session.has(m) && m !== 'state.apply',
      );
      if (methods.length === 0) skip('no side-effect-free method announced');
      const calls = methods.flatMap((m) => [m, m]);
      const results = await Promise.allSettled([
        ...calls.map((m) => ctx.session.requestRaw(m, PROBE_PARAMS[m], ctx.requestTimeoutMs)),
        rpcCodeOf(ctx.session.requestRaw('conformance.noSuchMethod', {}, ctx.requestTimeoutMs)),
      ]);
      results.forEach((r, i) => {
        if (r.status === 'rejected') fail(`${calls[i] ?? 'request'} failed: ${String(r.reason)}`);
      });
      const last = results[results.length - 1] as PromiseFulfilledResult<unknown>;
      if (last.value !== RpcErrorCode.MethodNotFound)
        fail('interleaved unknown method did not get -32601');
    },
  },
  {
    id: 'tree.shape',
    title: 'tree.get returns a valid tree and viewport',
    scenario: 'session',
    domains: ['tree'],
    async run(ctx) {
      const { root, viewport } = await getTree(ctx);
      assertValid(validateNodeTree(root), 'invalid tree');
      assertValid(validateViewport(viewport), 'invalid viewport');
    },
  },
  {
    id: 'tree.subtree',
    title: 'tree.get honors rootId and answers unknown ids with -32005',
    scenario: 'session',
    domains: ['tree'],
    async run(ctx) {
      const { root } = await getTree(ctx);
      const child =
        flatten(root).find((n) => n !== root && n.children.length > 0) ?? root.children[0];
      if (child) {
        const sub = await getTree(ctx, child.id);
        if (sub.root.id !== child.id)
          fail(`tree.get({rootId: "${child.id}"}) returned root "${sub.root.id}"`);
        assertValid(validateNodeTree(sub.root), 'invalid subtree');
      }
      const code = await rpcCodeOf(getTree(ctx, 'conformance-no-such-node'));
      if (code !== RpcErrorCode.NotFound) fail(`unknown rootId: expected -32005, got ${code}`);
    },
  },
  {
    id: 'tree.stable-ids',
    title: 'node ids are stable across tree.get calls',
    scenario: 'session',
    domains: ['tree'],
    async run(ctx) {
      const byTestId = (root: ProtocolNode) =>
        new Map(
          flatten(root)
            .filter((n) => n.testId)
            .map((n) => [n.testId as string, n.id]),
        );
      const first = byTestId((await getTree(ctx)).root);
      const second = byTestId((await getTree(ctx)).root);
      for (const [testId, id] of first) {
        const again = second.get(testId);
        if (again !== undefined && again !== id)
          fail(`node "${testId}" changed id from ${id} to ${again}`);
      }
    },
  },
  {
    id: 'focus.get',
    title: 'focus.get agrees with the focused node of the tree',
    scenario: 'session',
    domains: ['focus'],
    async run(ctx) {
      const consistent = await eventually(async () => {
        const { node } = (await ctx.session.requestRaw('focus.get', {}, ctx.requestTimeoutMs)) as {
          node: ProtocolNode | null;
        };
        if (node !== null) assertValid(validateNodeTree(node, 'node'), 'invalid focus.get node');
        const focused = flatten((await getTree(ctx)).root).find((n) => n.focused);
        return (node?.id ?? null) === (focused?.id ?? null);
      }, 2000);
      if (!consistent) fail('focus.get and tree.get disagree on the focused node');
    },
  },
  {
    id: 'sync.shape',
    title: 'sync.waitForIdle returns idle + busy within its timeout',
    scenario: 'session',
    domains: ['sync'],
    async run(ctx) {
      const started = Date.now();
      const result = (await ctx.session.requestRaw(
        'sync.waitForIdle',
        { timeoutMs: 3000 },
        3000 + ctx.requestTimeoutMs,
      )) as {
        idle: unknown;
        busy: unknown;
      };
      if (Date.now() - started > 4000) fail('answered more than 1s after timeoutMs');
      if (typeof result.idle !== 'boolean') fail('idle must be a boolean');
      assertValid(validateBusyResources(result.busy), 'invalid busy');
      if (!result.idle && (result.busy as unknown[]).length === 0)
        fail('idle=false must name at least one busy resource');
    },
  },
  {
    id: 'sync.zero-timeout',
    title: 'sync.waitForIdle with timeoutMs 0 answers immediately',
    scenario: 'session',
    domains: ['sync'],
    async run(ctx) {
      const started = Date.now();
      await ctx.session.requestRaw('sync.waitForIdle', { timeoutMs: 0 }, ctx.requestTimeoutMs);
      if (Date.now() - started > 1000) fail(`took ${Date.now() - started}ms`);
    },
  },
  {
    id: 'media.shape',
    title: 'media.get and media.list return valid players; unknown ids give null',
    scenario: 'session',
    domains: ['media'],
    async run(ctx) {
      const { media } = (await ctx.session.requestRaw('media.get', {}, ctx.requestTimeoutMs)) as {
        media: unknown;
      };
      if (media !== null) assertValid(validateMediaInfo(media), 'invalid media.get');
      const list = (await ctx.session.requestRaw('media.list', {}, ctx.requestTimeoutMs)) as {
        media: unknown;
      };
      if (!Array.isArray(list.media)) fail('media.list: media must be an array');
      list.media.forEach((m, i) =>
        assertValid(validateMediaInfo(m, `media[${i}]`), 'invalid media.list'),
      );
      const missing = (await ctx.session.requestRaw(
        'media.get',
        { id: 'conformance-no-such-player' },
        ctx.requestTimeoutMs,
      )) as {
        media: unknown;
      };
      if (missing.media !== null) fail('media.get with an unknown id must return media: null');
    },
  },
  {
    id: 'fixture.tree',
    title: 'fixture: tree contains the fixture elements with correct properties',
    scenario: 'session',
    domains: ['tree'],
    fixture: true,
    async run(ctx) {
      const nodes = flatten((await getTree(ctx)).root);
      const find = (id: string) =>
        nodes.find((n) => n.testId === id) ?? fail(`no node with testId "${id}"`);
      for (const id of [testIds.a, testIds.b]) {
        const n = find(id);
        if (!n.focusable || !n.visible || !n.enabled)
          fail(`"${id}" must be focusable, visible and enabled`);
        if (n.bounds.width <= 0 || n.bounds.height <= 0) fail(`"${id}" must have a non-empty size`);
      }
      const t = find(testIds.text);
      const ownText = [t, ...t.children].map((n) => n.text ?? '').join('');
      if (!ownText.includes(fixtureText)) fail(`"${testIds.text}" must have text "${fixtureText}"`);
      if (t.focusable) fail(`"${testIds.text}" must not be focusable`);
    },
  },
  {
    id: 'fixture.state',
    title: 'fixture: state.apply runs the onState handler and answers {}',
    scenario: 'session',
    domains: ['state'],
    fixture: true,
    async run(ctx) {
      const result = await apply(ctx, states.focusA);
      if (
        typeof result !== 'object' ||
        result === null ||
        Array.isArray(result) ||
        Object.keys(result).length > 0
      )
        fail(`expected {}, got ${JSON.stringify(result)}`);
    },
  },
  {
    id: 'fixture.state-error',
    title: 'fixture: a throwing onState handler gives -32004',
    scenario: 'session',
    domains: ['state'],
    fixture: true,
    async run(ctx) {
      const code = await rpcCodeOf(apply(ctx, states.fail));
      if (code !== RpcErrorCode.HandlerFailed) fail(`expected -32004, got ${code}`);
    },
  },
  {
    id: 'fixture.focus',
    title: 'fixture: focus moves are reported by focus.get and focus.changed',
    scenario: 'session',
    domains: ['focus', 'state'],
    fixture: true,
    async run(ctx) {
      await apply(ctx, states.focusA);
      await waitIdle(ctx, 3000);
      if (!(await eventually(async () => (await focusedTestId(ctx)) === testIds.a, 3000)))
        fail(`focus.get is not "${testIds.a}" after ${states.focusA}`);
      const nodes = flatten((await getTree(ctx)).root);
      const b = nodes.find((n) => n.testId === testIds.b) ?? fail(`no node "${testIds.b}"`);
      const changed = waitForNotification(
        ctx,
        'focus.changed',
        (p) => (p as { to?: unknown }).to === b.id,
        3000,
      );
      await apply(ctx, states.focusB);
      assertValid(validateFocusChanged(await changed), 'invalid focus.changed');
      if ((await focusedTestId(ctx)) !== testIds.b)
        fail(`focus.get is not "${testIds.b}" after ${states.focusB}`);
    },
  },
  {
    id: 'fixture.logs',
    title: 'fixture: console output arrives as logs.entry',
    scenario: 'session',
    domains: ['logs', 'state'],
    fixture: true,
    async run(ctx) {
      const marker = `toets-conformance-${Math.random().toString(36).slice(2)}`;
      const entry = waitForNotification(
        ctx,
        'logs.entry',
        (p) =>
          typeof (p as { message?: unknown }).message === 'string' &&
          (p as { message: string }).message.includes(marker),
        3000,
      );
      await apply(ctx, states.log, { marker });
      assertValid(validateLogEntry(await entry), 'invalid logs.entry');
    },
  },
  {
    id: 'fixture.busy',
    title: 'fixture: markBusy keeps the app busy (named) until released',
    scenario: 'session',
    domains: ['sync', 'state'],
    fixture: true,
    async run(ctx) {
      await apply(ctx, states.busy, { ms: 1500 });
      const busy = (await ctx.session.requestRaw(
        'sync.waitForIdle',
        { timeoutMs: 300 },
        ctx.requestTimeoutMs + 300,
      )) as {
        idle: boolean;
        busy: Array<{ kind: string }>;
      };
      if (busy.idle) fail('reported idle while marked busy');
      if (!busy.busy.some((r) => r.kind === 'custom'))
        fail('busy does not include a "custom" resource');
      const idle = (await ctx.session.requestRaw(
        'sync.waitForIdle',
        { timeoutMs: 5000 },
        ctx.requestTimeoutMs + 5000,
      )) as {
        idle: boolean;
        busy: unknown[];
      };
      if (!idle.idle) fail(`not idle after the busy mark ended: ${JSON.stringify(idle.busy)}`);
    },
  },
  {
    id: 'notifications.valid',
    title: 'notifications are well-formed and belong to announced domains',
    scenario: 'session',
    async run(ctx) {
      for (const { method, params } of ctx.notifications) {
        const domain = NOTIFICATION_DOMAIN[method as keyof typeof NOTIFICATION_DOMAIN];
        if (domain === undefined) fail(`unknown notification "${method}"`);
        if (!ctx.session.domains.has(domain))
          fail(`"${method}" sent without announcing "${domain}"`);
        if (method === 'logs.entry') assertValid(validateLogEntry(params), 'invalid logs.entry');
        if (method === 'focus.changed')
          assertValid(validateFocusChanged(params), 'invalid focus.changed');
        if (method === 'media.changed')
          assertValid(validateMediaInfo(params, 'params'), 'invalid media.changed');
      }
    },
  },
  {
    id: 'session.no-reconnect',
    title: 'after the host closes the session the SDK does not reconnect',
    scenario: 'session',
    async run(ctx) {
      const before = ctx.connections();
      await ctx.session.close();
      await new Promise((r) => setTimeout(r, 1500));
      if (ctx.connections() !== before) fail('the SDK reconnected after a normal close');
    },
  },
];

export const launchStateChecks: Check<SessionContext>[] = [
  {
    id: 'fixture.launch-state',
    title: 'fixture: the payload state is applied at launch',
    scenario: 'launch-state',
    domains: ['focus', 'state'],
    fixture: true,
    async run(ctx) {
      await waitIdle(ctx, 5000);
      if (!(await eventually(async () => (await focusedTestId(ctx)) === testIds.b, 3000)))
        fail(`focus is not on "${testIds.b}" after launching with state "${states.focusB}"`);
    },
  },
];

function rejectChecks(scenario: Scenario, what: string): Check<RejectContext>[] {
  return [
    {
      id: `handshake.${scenario === 'reject-unauthorized' ? 'unauthorized' : 'incompatible'}`,
      title: `stops (no reconnect) when the host rejects the hello as ${what}`,
      scenario,
      async run(ctx) {
        if (ctx.connections === 0) fail('the SDK never connected');
        if (ctx.connections > 1)
          fail(`the SDK reconnected ${ctx.connections - 1} time(s) after the rejection`);
      },
    },
  ];
}

export const rejectionChecks: Check<RejectContext>[] = [
  {
    id: 'handshake.hello-first',
    title: 'the first frame is a toets.hello request with the payload token',
    scenario: 'reject-unauthorized',
    async run(ctx) {
      if (ctx.firstFrame === null) fail('the SDK sent nothing');
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(ctx.firstFrame) as Record<string, unknown>;
      } catch {
        fail('the first frame is not JSON');
      }
      if (msg.jsonrpc !== '2.0' || msg.method !== HELLO_METHOD || msg.id === undefined)
        fail(`the first frame is not a toets.hello request: ${ctx.firstFrame.slice(0, 200)}`);
      if ((msg.params as Partial<HelloParams> | undefined)?.token !== ctx.token)
        fail('hello token does not match the payload');
    },
  },
  ...rejectChecks('reject-unauthorized', 'unauthorized'),
  ...rejectChecks('reject-incompatible', 'incompatible'),
];

/** Next received frame that is a response (has `result` or `error`), skipping notifications. */
function nextFrame(session: Session, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new CheckFailed(`no reply within ${timeoutMs}ms`));
    }, timeoutMs);
    const off = session.onRawMessage((data) => {
      try {
        const msg = JSON.parse(data) as Record<string, unknown>;
        if (!('error' in msg) && !('result' in msg)) return;
      } catch {
        // not JSON: report it as the reply
      }
      clearTimeout(timer);
      off();
      resolve(data);
    });
  });
}

async function expectAlive(ctx: SessionContext): Promise<void> {
  const code = await rpcCodeOf(
    ctx.session.requestRaw('conformance.noSuchMethod', {}, ctx.requestTimeoutMs),
  );
  if (code !== RpcErrorCode.MethodNotFound) fail('connection unusable after a malformed frame');
}
