import { createHash } from 'node:crypto';
import { mkdirSync, readlinkSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CommandRunner, SpawnedProcess } from './command.js';
import { DOCS, androidError } from './errors.js';

const require = createRequire(import.meta.url);

/** A running Appium server the driver can open sessions on. */
export interface AppiumServer {
  readonly hostname: string;
  readonly port: number;
  /** Stops the server if the driver started it. Safe to call twice. */
  stop(): Promise<void>;
}

export interface StartAppiumOptions {
  readonly runner: CommandRunner;
  /** Environment for the server (must carry `ANDROID_HOME`). */
  readonly env: NodeJS.ProcessEnv;
  /** Fixed port; default: a free port. */
  readonly port?: number;
  /** Appium server log file. */
  readonly logFile?: string;
  readonly startTimeoutMs?: number;
  readonly log?: (message: string) => void;
}

/**
 * Starts the Appium server pinned in this package's dependencies with the pinned UiAutomator2
 * driver. Nothing global is used or modified: the server runs with a private `APPIUM_HOME`
 * whose `node_modules` links to the bundled driver.
 */
export async function startAppiumServer(opts: StartAppiumOptions): Promise<AppiumServer> {
  const hostname = '127.0.0.1';
  const port = opts.port ?? (await freePort());
  const appiumMain = join(dirname(require.resolve('appium/package.json')), 'index.js');
  const env = { ...opts.env, APPIUM_HOME: ensureAppiumHome() };
  const lines: string[] = [];
  const proc = opts.runner.spawn(
    process.execPath,
    [
      appiumMain,
      'server',
      '--address',
      hostname,
      '--port',
      String(port),
      '--log-no-colors',
      '--log-timestamp',
    ],
    {
      env,
      ...(opts.logFile ? { logFile: opts.logFile } : {}),
      onLine: (line) => {
        lines.push(line);
        if (lines.length > 50) lines.shift();
      },
    },
  );
  try {
    await waitForReady(`http://${hostname}:${port}/status`, proc, opts.startTimeoutMs ?? 60_000);
  } catch (e) {
    proc.kill('SIGKILL');
    throw androidError('ANDROID_APPIUM_START_FAILED', `Appium did not start on port ${port}.`, {
      hint: `Last server output:\n${lines.slice(-15).join('\n') || '(none)'}`,
      docs: DOCS.setup,
      cause: e,
    });
  }
  opts.log?.(`appium: listening on ${hostname}:${port}`);
  let stopping: Promise<void> | undefined;
  return {
    hostname,
    port,
    stop: () => (stopping ??= stopProcess(proc)),
  };
}

/** An externally managed server (`appium.url` option). `stop()` leaves it running. */
export function externalAppiumServer(url: string): AppiumServer {
  const u = new URL(url);
  return {
    hostname: u.hostname,
    port: Number(u.port || (u.protocol === 'https:' ? 443 : 80)),
    stop: async () => {},
  };
}

/**
 * A private Appium home: `<tmp>/toets-appium/<hash>/node_modules/appium-uiautomator2-driver`
 * linking to the driver resolved from this package. Keyed by the driver's real path, so
 * different installs never share (or fight over) one manifest.
 */
export function ensureAppiumHome(): string {
  const driverDir = realpathSync(
    dirname(require.resolve('appium-uiautomator2-driver/package.json')),
  );
  const hash = createHash('sha256').update(driverDir).digest('hex').slice(0, 12);
  const home = join(tmpdir(), 'toets-appium', hash);
  const modules = join(home, 'node_modules');
  const link = join(modules, 'appium-uiautomator2-driver');
  mkdirSync(modules, { recursive: true });
  const current = readLink(link);
  if (current !== driverDir) {
    if (current !== null) unlinkSync(link);
    try {
      symlinkSync(driverDir, link, 'junction');
    } catch (e) {
      // Another worker created it at the same moment.
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  return home;
}

function readLink(path: string): string | null {
  try {
    return readlinkSync(path);
  } catch {
    return null;
  }
}

/** Asks the OS for a free TCP port on localhost. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function waitForReady(url: string, proc: SpawnedProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let exited = false;
  void proc.exited.then(() => (exited = true));
  while (Date.now() < deadline) {
    if (exited) throw new Error('Appium exited during startup.');
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const body = (await res.json()) as { value?: { ready?: boolean } };
        if (body.value?.ready !== false) return;
      }
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timed out after ${timeoutMs}ms.`);
}

async function stopProcess(proc: SpawnedProcess): Promise<void> {
  proc.kill('SIGTERM');
  const killed = await Promise.race([
    proc.exited.then(() => true),
    new Promise<false>((r) => setTimeout(() => r(false), 10_000)),
  ]);
  if (!killed) {
    proc.kill('SIGKILL');
    await proc.exited;
  }
}
