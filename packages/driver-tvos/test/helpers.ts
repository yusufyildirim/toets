import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { CommandResult, CommandRunner, RunOptions } from '../src/command.js';

/** A child process the test controls: write to `stdout`/`stderr`, observe `kill`. */
export class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly signals: string[] = [];

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.signals.push(signal);
    if (this.exitCode === null && this.signalCode === null) {
      queueMicrotask(() => this.exit(null, signal));
    }
    return true;
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit('exit', code, signal);
  }

  asChild(): ChildProcess {
    return this as unknown as ChildProcess;
  }
}

export interface RecordedCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly opts: RunOptions | undefined;
}

type Responder = (args: readonly string[]) => Partial<CommandResult> | undefined;

/**
 * Scripted {@link CommandRunner}: the first responder whose key is contained in
 * `<command> <args...>` answers; unmatched commands succeed with empty output.
 */
export class FakeRunner implements CommandRunner {
  readonly calls: RecordedCall[] = [];
  readonly spawned: { args: readonly string[]; child: FakeChild }[] = [];
  private readonly responders: [string, Responder][] = [];

  on(key: string, respond: Responder | Partial<CommandResult>): this {
    this.responders.push([key, typeof respond === 'function' ? respond : () => respond]);
    return this;
  }

  async run(command: string, args: readonly string[], opts?: RunOptions): Promise<CommandResult> {
    this.calls.push({ command, args, opts });
    const line = [command, ...args].join(' ');
    for (const [key, respond] of this.responders) {
      if (line.includes(key)) {
        const res = respond(args);
        if (res) return { stdout: '', stderr: '', exitCode: 0, ...res };
      }
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  spawn(command: string, args: readonly string[]): ChildProcess {
    const child = new FakeChild();
    this.spawned.push({ args: [command, ...args], child });
    return child.asChild();
  }

  /** Command lines run so far, e.g. `xcrun simctl create ...`. */
  lines(): string[] {
    return this.calls.map((c) => [c.command, ...c.args].join(' '));
  }
}

export const TVOS_RUNTIME = 'com.apple.CoreSimulator.SimRuntime.tvOS-27-2';
export const ATV_1080P = 'com.apple.CoreSimulator.SimDeviceType.Apple-TV-4K-3rd-generation-1080p';
export const ATV_4K = 'com.apple.CoreSimulator.SimDeviceType.Apple-TV-4K-3rd-generation-4K';

export const DEVICE_TYPES_JSON = JSON.stringify({
  devicetypes: [
    {
      name: 'iPhone 17',
      identifier: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17',
      productFamily: 'iPhone',
    },
    { name: 'Apple TV 4K (3rd generation)', identifier: ATV_4K, productFamily: 'Apple TV' },
    {
      name: 'Apple TV 4K (3rd generation) (at 1080p)',
      identifier: ATV_1080P,
      productFamily: 'Apple TV',
    },
  ],
});

export function runtimesJson(
  runtimes: { version: string; identifier?: string; platform?: string; isAvailable?: boolean }[],
): string {
  return JSON.stringify({
    runtimes: runtimes.map((r) => ({
      identifier:
        r.identifier ?? `com.apple.CoreSimulator.SimRuntime.tvOS-${r.version.replaceAll('.', '-')}`,
      name: `${r.platform ?? 'tvOS'} ${r.version}`,
      version: r.version,
      platform: r.platform ?? 'tvOS',
      isAvailable: r.isAvailable ?? true,
      supportedDeviceTypes: [{ identifier: ATV_4K }, { identifier: ATV_1080P }],
    })),
  });
}

export function devicesJson(
  devices: Record<string, { udid: string; name: string; state: string; isAvailable?: boolean }[]>,
): string {
  return JSON.stringify({ devices });
}
