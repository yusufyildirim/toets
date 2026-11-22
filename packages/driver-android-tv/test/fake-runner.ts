import type {
  CommandResult,
  CommandRunner,
  RunOptions,
  SpawnOptions,
  SpawnedProcess,
} from '../src/command.js';

export interface RecordedCall {
  readonly kind: 'run' | 'spawn';
  readonly file: string;
  readonly args: readonly string[];
  readonly opts: RunOptions | SpawnOptions | undefined;
}

/** A spawned process the test controls. */
export class FakeProcess implements SpawnedProcess {
  readonly pid = 4242;
  readonly signals: NodeJS.Signals[] = [];
  readonly exited: Promise<number | null>;
  private resolveExit!: (code: number | null) => void;

  constructor(
    readonly call: RecordedCall,
    /** Exit as soon as a signal arrives (like a well-behaved process). */
    private readonly exitOnSignal = true,
  ) {
    this.exited = new Promise((r) => (this.resolveExit = r));
  }

  exit(code: number | null = 0): void {
    this.resolveExit(code);
  }

  /** Feeds a line to the `onLine` callback the process was spawned with. */
  emit(line: string, stream: 'stdout' | 'stderr' = 'stdout'): void {
    (this.call.opts as SpawnOptions | undefined)?.onLine?.(line, stream);
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): void {
    this.signals.push(signal);
    if (this.exitOnSignal) this.resolveExit(null);
  }
}

type Responder = (
  args: readonly string[],
  file: string,
) => Partial<CommandResult> | string | undefined;

/**
 * Scriptable {@link CommandRunner}: every call is recorded; `on(match, reply)` answers runs
 * whose `file + args` contain `match`. Unmatched runs succeed with empty output.
 */
export class FakeRunner implements CommandRunner {
  readonly calls: RecordedCall[] = [];
  readonly processes: FakeProcess[] = [];
  private readonly responders: { match: string | RegExp; reply: Responder }[] = [];
  /** Decides whether spawned processes exit when signaled. */
  exitOnSignal = true;

  on(match: string | RegExp, reply: Responder | string | Partial<CommandResult>): this {
    const fn: Responder = typeof reply === 'function' ? reply : () => reply;
    this.responders.unshift({ match, reply: fn });
    return this;
  }

  async run(file: string, args: readonly string[], opts?: RunOptions): Promise<CommandResult> {
    this.calls.push({ kind: 'run', file, args, opts });
    const line = [file, ...args].join(' ');
    for (const r of this.responders) {
      const hit = typeof r.match === 'string' ? line.includes(r.match) : r.match.test(line);
      if (!hit) continue;
      const out = r.reply(args, file);
      if (out === undefined) continue;
      const res = typeof out === 'string' ? { stdout: out } : out;
      return { stdout: res.stdout ?? '', stderr: res.stderr ?? '', exitCode: res.exitCode ?? 0 };
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  spawn(file: string, args: readonly string[], opts?: SpawnOptions): SpawnedProcess {
    const call: RecordedCall = { kind: 'spawn', file, args, opts };
    this.calls.push(call);
    const proc = new FakeProcess(call, this.exitOnSignal);
    this.processes.push(proc);
    return proc;
  }

  /** Commands as single strings (`file` basename + args), in order. */
  lines(kind?: 'run' | 'spawn'): string[] {
    return this.calls
      .filter((c) => !kind || c.kind === kind)
      .map((c) => [c.file.split('/').pop(), ...c.args].join(' '));
  }
}

/** Replies that make an `adb` device look booted and healthy. */
export function bootedDevice(runner: FakeRunner): FakeRunner {
  return runner
    .on('get-state', 'device\n')
    .on('getprop sys.boot_completed', '1\n')
    .on('getprop ro.build.version.sdk', '33\n')
    .on('pm has-feature android.software.leanback', 'true\n');
}
