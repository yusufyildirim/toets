import { spawn as nodeSpawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { androidError } from './errors.js';

/** Outcome of a finished command. A non-zero `exitCode` is an answer, not an exception. */
export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface RunOptions {
  /** Kill the command and throw `ANDROID_COMMAND_TIMEOUT` after this long. Default 60s. */
  readonly timeoutMs?: number;
  /** Written to stdin, which is then closed. */
  readonly input?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface SpawnOptions {
  readonly env?: NodeJS.ProcessEnv;
  /** Receives stdout and stderr line by line. */
  readonly onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
  /** Appends stdout and stderr to this file. */
  readonly logFile?: string;
  /** Let the process outlive this one (emulators kept for reuse). */
  readonly detached?: boolean;
}

/** A long-running child process (logcat, screenrecord, emulator, Appium). */
export interface SpawnedProcess {
  readonly pid: number | undefined;
  /** Resolves with the exit code (`null` when killed by a signal). Never rejects. */
  readonly exited: Promise<number | null>;
  kill(signal?: NodeJS.Signals): void;
}

/**
 * Seam between the driver and the operating system. Every `adb`, `emulator`, `avdmanager` and
 * Appium invocation goes through one, so unit tests swap in a fake and nothing else changes.
 */
export interface CommandRunner {
  run(file: string, args: readonly string[], opts?: RunOptions): Promise<CommandResult>;
  spawn(file: string, args: readonly string[], opts?: SpawnOptions): SpawnedProcess;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** The real {@link CommandRunner} over `node:child_process`. */
export const nodeCommandRunner: CommandRunner = {
  run(file, args, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return new Promise((resolve, reject) => {
      const child = nodeSpawn(file, args, {
        env: opts.env ?? process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);
      child.stdout.on('data', (b: Buffer) => out.push(b));
      child.stderr.on('data', (b: Buffer) => err.push(b));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(
          androidError('ANDROID_COMMAND_FAILED', `Could not run ${file}: ${e.message}`, {
            hint: 'Check that the Android SDK is installed and `ANDROID_HOME` points to it.',
            cause: e,
          }),
        );
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(
            androidError(
              'ANDROID_COMMAND_TIMEOUT',
              `\`${formatCommand(file, args)}\` did not finish within ${timeoutMs}ms.`,
              { hint: 'The device may be unresponsive. Check it with `adb devices`.' },
            ),
          );
          return;
        }
        resolve({
          stdout: Buffer.concat(out).toString('utf8'),
          stderr: Buffer.concat(err).toString('utf8'),
          exitCode: code ?? -1,
        });
      });
      if (opts.input !== undefined) child.stdin.end(opts.input);
      else child.stdin.end();
    });
  },

  spawn(file, args, opts = {}) {
    const log = opts.logFile ? createWriteStream(opts.logFile, { flags: 'a' }) : undefined;
    const child = nodeSpawn(file, args, {
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: opts.detached ?? false,
    });
    for (const stream of ['stdout', 'stderr'] as const) {
      const source = child[stream];
      if (log) source.pipe(log, { end: false });
      if (opts.onLine) {
        const onLine = opts.onLine;
        let rest = '';
        source.setEncoding('utf8');
        source.on('data', (chunk: string) => {
          const lines = (rest + chunk).split(/\r?\n/);
          rest = lines.pop() ?? '';
          for (const line of lines) onLine(line, stream);
        });
        source.on('end', () => {
          if (rest) onLine(rest, stream);
        });
      } else if (!log) {
        source.resume();
      }
    }
    if (opts.detached) child.unref();
    const exited = new Promise<number | null>((resolve) => {
      child.on('error', () => resolve(-1));
      child.on('close', (code) => {
        log?.end();
        resolve(code);
      });
    });
    return {
      pid: child.pid,
      exited,
      kill: (signal = 'SIGTERM') => {
        if (child.exitCode === null && child.signalCode === null) child.kill(signal);
      },
    };
  },
};

/** Renders a command for error messages. */
export function formatCommand(file: string, args: readonly string[]): string {
  return [file, ...args].map((a) => (/^[\w./:=@%+-]+$/.test(a) ? a : JSON.stringify(a))).join(' ');
}

/**
 * Quotes one argument for the device's `sh`. `adb shell` joins its arguments with spaces and
 * hands the result to a shell, so anything with spaces, quotes or `$` must be quoted.
 */
export function shellQuote(arg: string): string {
  if (arg !== '' && /^[\w./:=@%+,-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}
