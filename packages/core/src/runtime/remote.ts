import type { Remote } from '../api.js';
import { KEY_CAPABILITY } from '../capabilities.js';
import { DpadError, packageDocsLink } from '../errors.js';
import { Key, type KeyOverride, type PressOptions } from '../keys.js';
import type { RuntimeContext } from './context.js';
import { sleep } from './retry.js';

const KEYS = new Set<string>(Object.values(Key));

function assertKey(key: unknown): asserts key is Key {
  if (typeof key !== 'string' || !KEYS.has(key)) {
    throw new DpadError('UNKNOWN_KEY', `Unknown key ${JSON.stringify(key)}.`, {
      hint: 'Use the semantic Key constants (Key.SELECT, Key.PLAY_PAUSE, ...). Raw platform keycodes are not accepted.',
      docs: packageDocsLink('core', 'remote'),
    });
  }
}

function assertCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new DpadError(
      'INVALID_ARGUMENT',
      `${name} must be a non-negative integer, got ${value}.`,
      {
        docs: packageDocsLink('core', 'remote'),
      },
    );
  }
}

const describeHold = (holdMs: number | undefined): string =>
  holdMs === undefined ? '' : ` ${holdMs}ms`;

/** How an overridden key is performed, e.g. `hold RIGHT 800ms` or `press SELECT`. */
export function describeKeyOverride(override: KeyOverride, holdMs = override.holdMs): string {
  return holdMs === undefined ? `press ${override.as}` : `hold ${override.as} ${holdMs}ms`;
}

/** How a key press is performed after key overrides. */
interface PressPlan {
  readonly performed: Key;
  readonly holdMs: number | undefined;
  /** Set when an override applied, e.g. `hold RIGHT 800ms`. */
  readonly performedAs: string | undefined;
}

function planPress(ctx: RuntimeContext, key: Key, opts?: PressOptions): PressPlan {
  const override = ctx.keyOverrides[key];
  const performed = override?.as ?? key;
  const holdMs = override?.holdMs ?? opts?.holdMs;
  const performedAs = override ? describeKeyOverride(override, holdMs) : undefined;
  return { performed, holdMs, performedAs };
}

/**
 * Why pressing `key` would fail on this target (unknown key, missing key capability, no long
 * press), after key overrides; `null` when the press would be sent.
 */
export function keyError(ctx: RuntimeContext, key: unknown, opts?: PressOptions): DpadError | null {
  try {
    assertKey(key);
  } catch (e) {
    return e as DpadError;
  }
  return planError(ctx, key, planPress(ctx, key, opts));
}

function planError(ctx: RuntimeContext, key: Key, plan: PressPlan): DpadError | null {
  const { performed, holdMs, performedAs } = plan;
  const platform = ctx.target.driver.platform;
  const caps = ctx.target.capabilities;
  const needed = KEY_CAPABILITY[performed];
  const via = performedAs ? ` (performed as ${performedAs} by a key override)` : '';
  if (needed && !caps.has(needed)) {
    return new DpadError(
      'KEY_UNSUPPORTED',
      `${platform} has no ${performed} key${via}: it needs capability '${needed}'.`,
      {
        hint: performedAs
          ? `Fix the key override for ${key} in the dpad config so it uses a key this platform has.`
          : `Declare requires('${needed}') on the test so it is skipped here, or, if the app maps this action to another gesture on ${platform}, add a key override for ${key}.`,
        docs: packageDocsLink('core', 'remote'),
      },
    );
  }
  if (holdMs !== undefined && !caps.has('key.longpress')) {
    return new DpadError(
      'KEY_UNSUPPORTED',
      `${platform} cannot hold keys${via}: long presses need capability 'key.longpress'.`,
      {
        hint: `Declare requires('key.longpress') on the test so it is skipped here.`,
        docs: packageDocsLink('core', 'remote'),
      },
    );
  }
  return null;
}

/**
 * The remote: semantic keys only. Every press goes through key overrides, then a capability
 * check, then the driver; each press is one reported step. `repeat` and `sequence` check every
 * key before pressing the first, so an unsupported key never leaves the app half-way.
 */
export class RemoteImpl implements Remote {
  constructor(private readonly ctx: RuntimeContext) {}

  async press(key: Key, opts?: PressOptions): Promise<void> {
    assertKey(key);
    const plan = planPress(this.ctx, key, opts);
    const error = planError(this.ctx, key, plan);
    if (error) throw error;
    const { performed, holdMs, performedAs } = plan;

    const verb = opts?.holdMs === undefined ? 'press' : 'longPress';
    const title = `${verb} ${key}${describeHold(opts?.holdMs)}${performedAs ? ` (override: ${performedAs})` : ''}`;
    await this.ctx.step(
      performedAs
        ? { kind: 'press', title, override: { key, performedAs } }
        : { kind: 'press', title },
      async () => {
        await this.ctx.target.driver.press(
          performed,
          holdMs === undefined ? undefined : { holdMs },
        );
        this.ctx.recordKey({
          key,
          at: Date.now(),
          ...(performedAs ? { performedAs } : {}),
          ...(holdMs === undefined ? {} : { holdMs }),
        });
      },
    );
  }

  longPress(key: Key, holdMs: number = this.ctx.remote.longPressMs): Promise<void> {
    return this.press(key, { holdMs });
  }

  async repeat(key: Key, times: number, opts?: { intervalMs?: number }): Promise<void> {
    assertKey(key);
    assertCount('times', times);
    this.checkAll([key]);
    const interval = opts?.intervalMs ?? this.ctx.remote.intervalMs;
    await this.ctx.step({ kind: 'repeat', title: `repeat ${key} x${times}` }, async () => {
      for (let i = 0; i < times; i++) {
        if (i > 0) await sleep(interval);
        await this.press(key);
      }
    });
  }

  async sequence(keys: readonly Key[], opts?: { intervalMs?: number }): Promise<void> {
    keys.forEach(assertKey);
    this.checkAll(keys);
    const interval = opts?.intervalMs ?? this.ctx.remote.intervalMs;
    await this.ctx.step({ kind: 'sequence', title: `sequence ${keys.join(', ')}` }, async () => {
      for (const [i, key] of keys.entries()) {
        if (i > 0) await sleep(interval);
        await this.press(key);
      }
    });
  }

  private checkAll(keys: readonly Key[]): void {
    for (const key of keys) {
      const error = planError(this.ctx, key, planPress(this.ctx, key));
      if (error) throw error;
    }
  }
}
