import type { ChildProcess } from 'node:child_process';
import type { LogEntry } from '@toets/core';
import type { Simctl } from './simctl.js';

const MAX_BUFFERED = 5000;

/**
 * Streams the app's unified log (`log stream --style ndjson` inside the simulator), filtered
 * to the app process. Entries buffer until drained; the oldest are dropped past 5000.
 */
export class AppLogStream {
  private child: ChildProcess | undefined;
  private entries: LogEntry[] = [];
  private dropped = 0;
  private partial = '';

  constructor(
    private readonly simctl: Simctl,
    private readonly udid: string,
    /** Executable name of the app (`CFBundleExecutable`). */
    private readonly processName: string,
  ) {}

  start(): void {
    if (this.child) return;
    const predicate = `process == "${this.processName.replaceAll('"', '\\"')}"`;
    const child = this.simctl.spawn([
      'spawn',
      this.udid,
      'log',
      'stream',
      '--style',
      'ndjson',
      '--level',
      'info',
      '--predicate',
      predicate,
    ]);
    this.child = child;
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => this.onData(chunk));
    child.on('exit', (code, signal) => {
      if (this.child !== child) return;
      this.child = undefined;
      this.push({
        level: 'warn',
        message: `tvOS log stream ended (code ${code}, signal ${signal}); app logs are no longer collected`,
        timestamp: Date.now(),
        source: 'driver',
      });
    });
    child.on('error', () => {});
  }

  stop(): void {
    const child = this.child;
    this.child = undefined;
    child?.kill('SIGTERM');
  }

  drain(): LogEntry[] {
    const out = this.entries;
    if (this.dropped > 0) {
      out.unshift({
        level: 'warn',
        message: `${this.dropped} older log entries were dropped (buffer holds ${MAX_BUFFERED})`,
        timestamp: Date.now(),
        source: 'driver',
      });
    }
    this.entries = [];
    this.dropped = 0;
    return out;
  }

  private onData(chunk: string): void {
    const lines = (this.partial + chunk).split('\n');
    this.partial = lines.pop() ?? '';
    for (const line of lines) {
      const entry = parseLogLine(line);
      if (entry) this.push(entry);
    }
  }

  private push(entry: LogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_BUFFERED) {
      this.entries.shift();
      this.dropped++;
    }
  }
}

/** Parses one `log stream --style ndjson` line; `null` for headers and non-log events. */
export function parseLogLine(line: string): LogEntry | null {
  if (!line.startsWith('{')) return null;
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (event.eventType !== undefined && event.eventType !== 'logEvent') return null;
  const message = typeof event.eventMessage === 'string' ? event.eventMessage : null;
  if (message === null) return null;
  return {
    level: levelOf(event.messageType),
    message,
    timestamp: parseTimestamp(event.timestamp),
    source: 'app',
  };
}

function levelOf(messageType: unknown): LogEntry['level'] {
  switch (messageType) {
    case 'Debug':
      return 'debug';
    case 'Error':
    case 'Fault':
      return 'error';
    default:
      return 'info';
  }
}

/** `2026-11-22 10:00:00.123456+0100` -> epoch ms. */
function parseTimestamp(value: unknown): number {
  if (typeof value !== 'string') return Date.now();
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})(\.\d{1,3})?\d*([+-]\d{2})(\d{2})$/.exec(
    value,
  );
  if (!m) return Date.now();
  const ms = Date.parse(`${m[1]}T${m[2]}${m[3] ?? ''}${m[4]}:${m[5]}`);
  return Number.isNaN(ms) ? Date.now() : ms;
}
