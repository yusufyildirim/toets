import type { LogEntryParams, LogLevel } from '@dpad-tv/protocol';
import { getGlobal, now, sdkLogDepth } from '../env.js';

const MAX_MESSAGE = 10_000;
const METHODS: ReadonlyArray<[string, LogLevel]> = [
  ['debug', 'debug'],
  ['log', 'info'],
  ['info', 'info'],
  ['warn', 'warn'],
  ['error', 'error'],
];

/** Forwards console output to `onEntry`, then calls the original method. */
export function instrumentConsole(onEntry: (entry: LogEntryParams) => void): () => void {
  const c = getGlobal().console as Record<string, unknown> | undefined;
  if (!c) return () => {};
  const restore: Array<() => void> = [];
  let inside = false;
  for (const [name, level] of METHODS) {
    const orig = c[name] as ((...args: unknown[]) => unknown) | undefined;
    if (typeof orig !== 'function') continue;
    const wrapped = function (this: unknown, ...args: unknown[]): unknown {
      if (!inside && sdkLogDepth === 0) {
        inside = true;
        try {
          onEntry({ level, message: formatLogArgs(args), timestamp: now(), kind: 'console' });
        } catch {
          // Never break the app's logging.
        } finally {
          inside = false;
        }
      }
      return orig.apply(this, args);
    };
    c[name] = wrapped;
    restore.push(() => {
      if (c[name] === wrapped) c[name] = orig;
    });
  }
  return () => restore.forEach((r) => r());
}

/** Formats console arguments like browsers do (`%s`, `%d`, `%o` ... substitutions). */
export function formatLogArgs(args: readonly unknown[]): string {
  const rest = args.slice();
  let head = '';
  if (typeof rest[0] === 'string' && rest.length > 1 && /%[sdifoOjc%]/.test(rest[0])) {
    head = (rest.shift() as string).replace(/%([sdifoOjc%])/g, (match, f: string) => {
      if (f === '%') return '%';
      if (rest.length === 0) return match;
      const v = rest.shift();
      if (f === 'c') return '';
      if (f === 'd' || f === 'i') return String(parseInt(String(v), 10));
      if (f === 'f') return String(parseFloat(String(v)));
      return f === 's' ? String(v) : formatValue(v);
    });
  }
  const parts = rest.map(formatValue);
  const message = head ? [head].concat(parts).join(' ') : parts.join(' ');
  return message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE)}...` : message;
}

export function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (typeof value !== 'object' || value === null) return String(value);
  return safeJson(value);
}

function safeJson(value: object): string {
  const seen: object[] = [];
  try {
    const out = JSON.stringify(value, (_key, v: unknown) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.indexOf(v) >= 0) return '[Circular]';
        seen.push(v);
      }
      if (typeof v === 'function')
        return `[Function ${(v as { name?: string }).name || 'anonymous'}]`;
      if (typeof v === 'bigint') return `${String(v)}n`;
      return v;
    });
    if (out === undefined) return String(value);
    return out.length > 2000 ? `${out.slice(0, 2000)}...` : out;
  } catch {
    return Object.prototype.toString.call(value);
  }
}
