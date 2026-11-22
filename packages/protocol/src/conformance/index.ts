/**
 * Conformance suite for dpad SDK implementations (Node only). Import from
 * `@dpad-tv/protocol/conformance`; see `docs/conformance.md`.
 *
 * @example
 * const report = await runConformance({
 *   name: 'my-sdk',
 *   fixture: true,
 *   launch: ({ encoded }) => page.goto(`${appUrl}?__dpad=${encoded}`),
 *   terminate: () => page.goto('about:blank'),
 * });
 * if (!report.passed) throw new Error(formatConformanceReport(report));
 */
import { encodeLaunchPayloadParam, type LaunchPayload } from '../launch.js';
import { CloseCode, HELLO_METHOD, PROTOCOL_VERSION, type HelloParams } from '../messages.js';
import { RpcErrorCode } from '../jsonrpc.js';
import { createSdkHost } from '../server/host.js';
import { listenWebSocket } from '../server/listen.js';
import type { Session } from '../server/session.js';
import {
  CheckFailed,
  CheckSkipped,
  launchStateChecks,
  rejectionChecks,
  sessionChecks,
  type Check,
  type RejectContext,
  type Scenario,
  type SessionContext,
} from './checks.js';
import { CONFORMANCE_FIXTURE } from '../fixture.js';
import type {
  CheckResult,
  ConformanceOptions,
  ConformanceReport,
  ConformanceTarget,
} from './types.js';

export * from './types.js';
export { CONFORMANCE_FIXTURE } from '../fixture.js';

/** Ids of every check, in run order. */
export const CONFORMANCE_CHECKS: readonly string[] = [
  ...sessionChecks,
  ...launchStateChecks,
  ...rejectionChecks,
].map((c) => c.id);

/** Runs the suite against `target` and returns a report. Never throws for check failures. */
export async function runConformance(
  target: ConformanceTarget,
  options: ConformanceOptions = {},
): Promise<ConformanceReport> {
  const connectTimeoutMs = options.connectTimeoutMs ?? 15_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 5_000;
  const selected = <C>(checks: Check<C>[]) =>
    checks.filter(
      (c) => !options.only || options.only.some((o) => c.id === o || c.id.startsWith(o)),
    );
  const results: CheckResult[] = [];
  const record = (result: CheckResult): void => {
    results.push(result);
    options.onResult?.(result);
  };
  let hello: HelloParams | undefined;

  const runChecks = async <C>(checks: Check<C>[], ctx: C, domains: ReadonlySet<string>) => {
    for (const check of checks) {
      const missing = (check.domains ?? []).filter((d) => !domains.has(d));
      if (check.fixture && !target.fixture) {
        record(skipped(check, 'target does not implement the conformance fixture'));
      } else if (missing.length > 0) {
        record(skipped(check, `domain not announced: ${missing.join(', ')}`));
      } else {
        record(await runOne(check, ctx));
      }
    }
  };
  const failAll = <C>(checks: Check<C>[], message: string) => {
    for (const check of checks)
      record({ id: check.id, title: check.title, status: 'fail', message, durationMs: 0 });
  };

  // Main session.
  const main = selected(sessionChecks);
  if (main.length > 0) {
    await withSession(target, {}, connectTimeoutMs, requestTimeoutMs, async (ctx, error) => {
      if (!ctx) return failAll(main, error);
      hello = ctx.session.hello;
      await runChecks(main, ctx, ctx.session.domains);
    });
  }

  // Launch state.
  const launch = selected(launchStateChecks);
  if (launch.length > 0) {
    const needs = launch.some((c) => c.fixture) && !target.fixture;
    if (needs) {
      for (const c of launch)
        record(skipped(c, 'target does not implement the conformance fixture'));
    } else {
      await withSession(
        target,
        { state: CONFORMANCE_FIXTURE.states.focusB },
        connectTimeoutMs,
        requestTimeoutMs,
        async (ctx, error) => {
          if (!ctx) return failAll(launch, error);
          await runChecks(launch, ctx, ctx.session.domains);
        },
      );
    }
  }

  // Rejected handshakes.
  for (const scenario of ['reject-unauthorized', 'reject-incompatible'] as const) {
    const checks = selected(rejectionChecks).filter((c) => c.scenario === scenario);
    if (checks.length === 0) continue;
    const ctx = await rejectedLaunch(target, scenario, connectTimeoutMs).catch(
      (e: unknown) => e as Error,
    );
    if (ctx instanceof Error) failAll(checks, ctx.message);
    else await runChecks(checks, ctx, new Set());
  }

  const report: ConformanceReport = {
    target: target.name ?? 'SDK under test',
    passed: results.every((r) => r.status !== 'fail'),
    results,
    ...(hello ? { hello } : {}),
  };
  return report;
}

/** Human-readable, deterministic report. */
export function formatConformanceReport(report: ConformanceReport): string {
  const lines = [`dpad protocol ${PROTOCOL_VERSION} conformance: ${report.target}`];
  if (report.hello) {
    lines.push(
      `SDK ${report.hello.sdk} (${report.hello.framework}), protocol ${report.hello.protocol}, domains: ${report.hello.domains.join(', ') || 'none'}`,
    );
  }
  for (const r of report.results) {
    const mark = r.status === 'pass' ? 'PASS' : r.status === 'fail' ? 'FAIL' : 'SKIP';
    lines.push(`${mark}  ${r.id}  ${r.title}${r.message ? `\n      ${r.message}` : ''}`);
  }
  const count = (s: string) => report.results.filter((r) => r.status === s).length;
  lines.push(`${count('pass')} passed, ${count('fail')} failed, ${count('skip')} skipped`);
  return lines.join('\n');
}

function skipped(check: { id: string; title: string }, message: string): CheckResult {
  return { id: check.id, title: check.title, status: 'skip', message, durationMs: 0 };
}

async function runOne<C>(check: Check<C>, ctx: C): Promise<CheckResult> {
  const started = Date.now();
  const base = { id: check.id, title: check.title };
  try {
    await check.run(ctx);
    return { ...base, status: 'pass', durationMs: Date.now() - started };
  } catch (error) {
    const durationMs = Date.now() - started;
    if (error instanceof CheckSkipped)
      return { ...base, status: 'skip', message: error.message, durationMs };
    const message =
      error instanceof CheckFailed ? error.message : `unexpected error: ${String(error)}`;
    return { ...base, status: 'fail', message, durationMs };
  }
}

async function withSession(
  target: ConformanceTarget,
  extra: Partial<LaunchPayload>,
  connectTimeoutMs: number,
  requestTimeoutMs: number,
  body: (ctx: SessionContext | null, error: string) => Promise<void>,
): Promise<void> {
  let connections = 0;
  const host = await createSdkHost({
    requestTimeoutMs,
    onEvent: (e) => {
      if (e.type === 'connection') connections++;
    },
  });
  try {
    const token = host.issueToken();
    const payload: LaunchPayload = { v: 1, sdkUrl: host.url, token, ...extra };
    let session: Session;
    try {
      await target.launch({ payload, encoded: encodeLaunchPayloadParam(payload) });
      session = (await host.waitForSession(token, { timeoutMs: connectTimeoutMs })) as Session;
    } catch (error) {
      await body(null, `no session: ${(error as Error).message}`);
      return;
    }
    const notifications: Array<{ method: string; params: unknown }> = [];
    session.onRawNotification((method, params) => notifications.push({ method, params }));
    await body(
      { session, token, requestTimeoutMs, notifications, connections: () => connections },
      '',
    );
  } finally {
    await Promise.resolve(target.terminate()).catch(() => {});
    await host.close();
  }
}

async function rejectedLaunch(
  target: ConformanceTarget,
  scenario: Extract<Scenario, 'reject-unauthorized' | 'reject-incompatible'>,
  connectTimeoutMs: number,
): Promise<RejectContext> {
  let connections = 0;
  let firstFrame: string | null = null;
  let connected: () => void = () => {};
  const firstConnection = new Promise<void>((resolve) => (connected = resolve));
  const unauthorized = scenario === 'reject-unauthorized';
  const listener = await listenWebSocket({
    onConnection: (socket) => {
      connections++;
      socket.on('error', () => {});
      socket.once('message', (data) => {
        const text = data.toString();
        if (firstFrame === null) firstFrame = text;
        let id: unknown = null;
        try {
          const msg = JSON.parse(text) as { id?: unknown; method?: unknown };
          if (msg.method === HELLO_METHOD) id = msg.id ?? null;
        } catch {
          // keep id null
        }
        const error = unauthorized
          ? { code: RpcErrorCode.Unauthorized, message: 'Unknown or expired token' }
          : {
              code: RpcErrorCode.IncompatibleProtocol,
              message: 'Incompatible protocol (conformance probe)',
              data: { protocol: '999.0.0' },
            };
        socket.send(JSON.stringify({ jsonrpc: '2.0', id, error }));
        socket.close(
          unauthorized ? CloseCode.Unauthorized : CloseCode.IncompatibleProtocol,
          'rejected',
        );
        connected();
      });
    },
  });
  try {
    const token = `conformance-${scenario}`;
    const payload: LaunchPayload = { v: 1, sdkUrl: listener.url, token };
    await target.launch({ payload, encoded: encodeLaunchPayloadParam(payload) });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>(
      (r) => (timer = setTimeout(() => r('timeout'), connectTimeoutMs)),
    );
    const first = await Promise.race([firstConnection, timeout]);
    clearTimeout(timer);
    if (first === 'timeout')
      throw new Error(`the SDK did not connect within ${connectTimeoutMs}ms`);
    // Long enough for any reconnect/backoff loop to show itself.
    await new Promise((r) => setTimeout(r, 2500));
    return { token, firstFrame, connections };
  } finally {
    await Promise.resolve(target.terminate()).catch(() => {});
    await listener.close();
  }
}
