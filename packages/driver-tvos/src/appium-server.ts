import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname } from 'node:path';
import { tail } from './command.js';
import { DOCS, TvosErrorCode, tvosError } from './errors.js';

/** A running Appium server owned by one driver instance. */
export interface AppiumServer {
  /** Base URL, e.g. `http://127.0.0.1:4723/`. */
  readonly url: string;
  readonly logFile: string;
  stop(): Promise<void>;
}

export interface StartAppiumOptions {
  /** Port to listen on. Default: a free port. */
  readonly port?: number;
  /** `APPIUM_HOME` holding the XCUITest driver. Default: this package (pinned dependency). */
  readonly home?: string;
  /** Extra Appium CLI arguments. */
  readonly args?: readonly string[];
  /** Default 60000. */
  readonly startTimeoutMs?: number;
  /** Appium server output goes here. */
  readonly logFile: string;
}

const require = createRequire(import.meta.url);

/**
 * Starts the Appium server pinned in this package's dependencies (with the pinned XCUITest
 * driver), as a child process listening on localhost only. Resolves once `/status` answers.
 */
export async function startAppiumServer(opts: StartAppiumOptions): Promise<AppiumServer> {
  const host = '127.0.0.1';
  const port = opts.port ?? (await freePort());
  const home = opts.home ?? defaultAppiumHome();
  const main = require.resolve('appium/index.js');
  await mkdir(dirname(opts.logFile), { recursive: true });
  const log = createWriteStream(opts.logFile, { flags: 'a' });
  const args = [
    main,
    'server',
    '--address',
    host,
    '--port',
    String(port),
    '--base-path',
    '/',
    '--use-drivers',
    'xcuitest',
    '--log-no-colors',
    '--log-timestamp',
    ...(opts.args ?? []),
  ];
  const child = spawn(process.execPath, args, {
    env: { ...process.env, APPIUM_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let recent = '';
  let listening = false;
  const collect = (chunk: Buffer) => {
    log.write(chunk);
    recent = (recent + chunk.toString('utf8')).slice(-8000);
    // Only our child's own line proves it owns the port (another server may answer /status).
    if (!listening && /listener started on/i.test(recent)) listening = true;
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  const killOnExit = () => child.kill('SIGKILL');
  process.once('exit', killOnExit);

  const url = `http://${host}:${port}/`;
  try {
    await waitUntilReady(url, child, () => listening, opts.startTimeoutMs ?? 60_000);
  } catch (cause) {
    process.removeListener('exit', killOnExit);
    child.kill('SIGKILL');
    log.end();
    throw tvosError(
      TvosErrorCode.APPIUM_START_FAILED,
      `Appium did not start on ${url}: ${cause instanceof Error ? cause.message : String(cause)}\n${tail(recent)}`,
      {
        hint: `Full log: ${opts.logFile}. Make sure the port is free and APPIUM_HOME (${home}) contains appium-xcuitest-driver.`,
        docs: DOCS.setup,
        cause,
      },
    );
  }

  let stopped: Promise<void> | undefined;
  return {
    url,
    logFile: opts.logFile,
    stop() {
      stopped ??= (async () => {
        process.removeListener('exit', killOnExit);
        await terminate(child, 10_000);
        await new Promise<void>((resolve) => log.end(resolve));
      })();
      return stopped;
    },
  };
}

/** The directory of this package: its `package.json` lists Appium and the XCUITest driver. */
export function defaultAppiumHome(): string {
  return dirname(require.resolve('@toets/driver-tvos/package.json'));
}

/** A TCP port that is free right now on localhost. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('Could not allocate a port'));
      });
    });
  });
}

async function waitUntilReady(
  url: string,
  child: ChildProcess,
  listening: () => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let exited: string | null = null;
  child.once('exit', (code, signal) => (exited = `exited early (code ${code}, signal ${signal})`));
  child.once('error', (err) => (exited = `failed to spawn: ${err.message}`));
  while (Date.now() < deadline) {
    if (exited) throw new Error(exited);
    if (!listening()) {
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }
    try {
      const res = await fetch(new URL('status', url), { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out after ${timeoutMs}ms`);
}

async function terminate(child: ChildProcess, graceMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), graceMs);
  await exited;
  clearTimeout(timer);
}
