import type { RecordedRequest } from '../api.js';
import type { Capability } from '../capabilities.js';
import type { Platform } from '../platform.js';
import type { LogEntry } from '../snapshot.js';
import type { KeyLogEntry } from './context.js';

/**
 * Everything an agent needs to act on a failure without re-running it. Every field is
 * collected independently: a dead driver yields `unavailable` sections, never a second error.
 */
export interface FailureDump {
  readonly platform: Platform;
  readonly capabilities: readonly Capability[];
  readonly sdk:
    | { readonly connected: false; readonly enabled: boolean }
    | {
        readonly connected: true;
        readonly sdk: string;
        readonly framework: string;
        readonly domains: readonly string[];
      };
  /** `card_a "Alpha"`, `nothing`, or `unavailable: <reason>`. */
  readonly focused: string;
  /** The open keyboard: `search (layer: lower)`, `system`, `none`, or `unavailable: <reason>`. */
  readonly keyboard: string;
  /** Title of the last launch (with its deep link and translation), `null` before one. */
  readonly lastLaunch: string | null;
  /** Title of the last `openDeepLink` since that launch, with its translation, or `null`. */
  readonly lastDeepLink: string | null;
  /** Text snapshot of the screen, or `unavailable: <reason>`. */
  readonly screen: string;
  /** What kept the app busy at dump time (SDK idle sync), if known. */
  readonly busy: string | null;
  readonly lastKeys: readonly KeyLogEntry[];
  readonly logs: readonly LogEntry[];
  readonly requests: readonly RecordedRequest[];
  /** PNG of the viewport, or `null` when it could not be taken. */
  readonly screenshot: Uint8Array | null;
}

const describeKey = (k: KeyLogEntry): string =>
  k.performedAs
    ? `${k.key} (override: ${k.performedAs})`
    : k.holdMs !== undefined
      ? `${k.key} (hold ${k.holdMs}ms)`
      : k.key;

const time = (ms: number): string => new Date(ms).toISOString().slice(11, 23);

/** Renders a dump as Markdown with a YAML screen section; deterministic apart from timestamps. */
export function formatFailureDump(dump: FailureDump): string {
  const out: string[] = ['# toets failure dump', ''];
  out.push(`- platform: ${dump.platform}`);
  out.push(`- capabilities: ${dump.capabilities.join(', ') || '(none)'}`);
  out.push(
    `- sdk: ${
      dump.sdk.connected
        ? `connected (${dump.sdk.sdk}, ${dump.sdk.framework}; domains: ${dump.sdk.domains.join(', ')})`
        : dump.sdk.enabled
          ? 'enabled, not connected'
          : 'off (black-box)'
    }`,
  );
  out.push(`- focused: ${dump.focused}`);
  out.push(`- keyboard: ${dump.keyboard}`);
  if (dump.lastLaunch) out.push(`- last launch: ${dump.lastLaunch}`);
  if (dump.lastDeepLink) out.push(`- last deep link: ${dump.lastDeepLink}`);
  if (dump.busy) out.push(`- busy: ${dump.busy}`);
  out.push(`- last keys: ${dump.lastKeys.map(describeKey).join(', ') || '(none)'}`);
  out.push('', '## Screen', '', '```yaml', dump.screen, '```');
  if (dump.logs.length) {
    out.push('', `## Logs (last ${dump.logs.length})`, '');
    for (const l of dump.logs)
      out.push(`- ${time(l.timestamp)} ${l.level} [${l.source}] ${l.message}`);
  }
  if (dump.requests.length) {
    out.push('', `## Requests (last ${dump.requests.length})`, '');
    for (const r of dump.requests) {
      const outcome = r.error
        ? `failed: ${r.error.code} ${r.error.message}`
        : `${r.status ?? 'pending'}${r.mocked ? ' (mocked)' : ''}`;
      out.push(`- ${time(r.timestamp)} ${r.method} ${r.url} -> ${outcome}`);
    }
  }
  return out.join('\n') + '\n';
}
