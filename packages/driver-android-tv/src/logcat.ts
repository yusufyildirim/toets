import type { LogEntry } from '@dpad-tv/core';
import type { Adb } from './adb.js';
import type { SpawnedProcess } from './command.js';

/**
 * - `app`: lines written by the app's processes (by uid, so restarts and extra processes are
 *   included), plus warnings and errors from other processes that name the app's package
 *   (crashes and ANRs reported by the system).
 * - `all`: every line on the device.
 */
export type LogcatScope = 'app' | 'all';

/** One parsed `logcat -v epoch -v uid` line. */
export interface LogcatLine {
  readonly timestamp: number;
  readonly uid: string;
  readonly pid: number;
  readonly level: 'V' | 'D' | 'I' | 'W' | 'E' | 'F' | 'S';
  readonly tag: string;
  readonly message: string;
}

const LINE = /^\s*(\d+)\.(\d+)\s+(\S+)\s+(\d+)\s+\d+\s+([VDIWEFS])\s+(.*?)\s*: (.*)$/;

export function parseLogcatLine(line: string): LogcatLine | null {
  const m = LINE.exec(line);
  if (!m) return null;
  const [, sec, frac, uid, pid, level, tag, message] = m as unknown as [
    string,
    string,
    string,
    string,
    string,
    LogcatLine['level'],
    string,
    string,
  ];
  return {
    timestamp: Number(sec) * 1000 + Math.round(Number(`0.${frac}`) * 1000),
    uid,
    pid: Number(pid),
    level,
    tag,
    message,
  };
}

const LEVEL: Record<LogcatLine['level'], LogEntry['level']> = {
  V: 'debug',
  D: 'debug',
  I: 'info',
  W: 'warn',
  E: 'error',
  F: 'error',
  S: 'debug',
};

/** Collects device logs in the background; `drain()` returns and clears what arrived. */
export class LogcatCollector {
  private proc: SpawnedProcess | undefined;
  private buffer: LogEntry[] = [];
  private appUid: string | null = null;
  private dropped = 0;

  constructor(
    private readonly adb: Adb,
    private readonly opts: {
      readonly scope: LogcatScope;
      readonly packageName: string;
      /** Oldest entries are dropped beyond this many. Default 10 000. */
      readonly maxEntries?: number;
    },
  ) {}

  /** Starts streaming from now on (older device logs are skipped). */
  start(): void {
    if (this.proc) return;
    this.proc = this.adb.spawn(['logcat', '-v', 'epoch', '-v', 'uid', '-v', 'printable', '-T', '1'], {
      onLine: (line, stream) => {
        if (stream === 'stdout') this.accept(line);
      },
    });
  }

  /** The app's uid; lines from it are attributed to the app. Unknown until installed. */
  setAppUid(uid: number | null): void {
    this.appUid = uid === null ? null : String(uid);
  }

  drain(): LogEntry[] {
    const out = this.buffer;
    this.buffer = [];
    if (this.dropped > 0) {
      out.unshift({
        level: 'warn',
        message: `dpad: ${this.dropped} older log lines were dropped (buffer full)`,
        timestamp: out[0]?.timestamp ?? Date.now(),
        source: 'driver',
      });
      this.dropped = 0;
    }
    return out;
  }

  async stop(): Promise<void> {
    const proc = this.proc;
    this.proc = undefined;
    if (!proc) return;
    proc.kill('SIGTERM');
    await proc.exited;
  }

  /** Visible for tests. */
  accept(raw: string): void {
    const line = parseLogcatLine(raw);
    if (!line) return;
    const fromApp = this.appUid !== null && line.uid === this.appUid;
    if (this.opts.scope === 'app' && !fromApp) {
      const relevant =
        (line.level === 'W' || line.level === 'E' || line.level === 'F') &&
        line.message.includes(this.opts.packageName);
      if (!relevant) return;
    }
    this.buffer.push({
      level: LEVEL[line.level],
      message: `${line.tag}: ${line.message}`,
      timestamp: line.timestamp,
      source: fromApp ? 'app' : 'device',
    });
    const max = this.opts.maxEntries ?? 10_000;
    if (this.buffer.length > max) {
      this.dropped += this.buffer.length - max;
      this.buffer.splice(0, this.buffer.length - max);
    }
  }
}
