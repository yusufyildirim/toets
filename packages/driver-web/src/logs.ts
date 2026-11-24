import type { LogEntry } from '@toets/core';
import type { ConsoleMessage } from 'playwright-core';

/** Bounded log buffer: keeps the newest entries and reports how many were dropped. */
export class LogBuffer {
  #entries: LogEntry[] = [];
  #dropped = 0;

  constructor(private readonly capacity = 10_000) {}

  push(entry: LogEntry): void {
    this.#entries.push(entry);
    // Trim in batches so a chatty app costs amortized O(1) per entry.
    if (this.#entries.length >= this.capacity * 2) this.#trim();
  }

  #trim(): void {
    const excess = this.#entries.length - this.capacity;
    if (excess <= 0) return;
    this.#entries.splice(0, excess);
    this.#dropped += excess;
  }

  /** Returns and clears the buffer. */
  drain(): LogEntry[] {
    this.#trim();
    const out = this.#entries;
    if (this.#dropped > 0) {
      out.unshift({
        level: 'warn',
        message: `${this.#dropped} older log entries were dropped (buffer holds ${this.capacity}).`,
        timestamp: out[0]?.timestamp ?? Date.now(),
        source: 'driver',
      });
    }
    this.#entries = [];
    this.#dropped = 0;
    return out;
  }
}

/** Maps a console message type to a log level. */
export function consoleLevel(type: ReturnType<ConsoleMessage['type']>): LogEntry['level'] {
  switch (type) {
    case 'debug':
    case 'trace':
      return 'debug';
    case 'warning':
      return 'warn';
    case 'error':
    case 'assert':
      return 'error';
    default:
      return 'info';
  }
}
