import { spawn, type ChildProcess } from 'node:child_process';

/** Result of a finished command. Non-zero exit codes are returned, never thrown. */
export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface RunOptions {
  /** Kill the command after this long. Default: no timeout. */
  readonly timeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Runs host tools (`xcrun simctl`, `xcodebuild`, `plutil`). Injected everywhere so device
 * orchestration is unit tested with a fake runner instead of real simulators.
 */
export interface CommandRunner {
  run(command: string, args: readonly string[], opts?: RunOptions): Promise<CommandResult>;
  /** Starts a long-running process (log streams, screen recording). */
  spawn(
    command: string,
    args: readonly string[],
    opts?: { readonly env?: NodeJS.ProcessEnv },
  ): ChildProcess;
}

/** The real runner, backed by `node:child_process`. */
export const defaultRunner: CommandRunner = {
  run(command, args, opts = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        env: opts.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
      child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
      const timer =
        opts.timeoutMs === undefined
          ? undefined
          : setTimeout(() => {
              stderr += `\n[toets] killed after ${opts.timeoutMs}ms timeout`;
              child.kill('SIGKILL');
            }, opts.timeoutMs);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? (signal ? 128 : 1) });
      });
    });
  },
  spawn(command, args, opts = {}) {
    return spawn(command, args, {
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  },
};

/** Last `lines` lines of a command's output, for error messages. */
export function tail(text: string, lines = 20): string {
  return text.trimEnd().split('\n').slice(-lines).join('\n');
}
