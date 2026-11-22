import type { Remote } from '../api.js';
import { KEY_CAPABILITY } from '../capabilities.js';
import { DpadError, docsLink } from '../errors.js';
import { Key, type PressOptions } from '../keys.js';
import type { RuntimeContext } from './context.js';
import { sleep } from './retry.js';

const KEYS = new Set<string>(Object.values(Key));

function assertKey(key: unknown): asserts key is Key {
  if (typeof key !== 'string' || !KEYS.has(key)) {
    throw new DpadError('UNKNOWN_KEY', `Unknown key ${JSON.stringify(key)}.`, {
      hint: 'Use the semantic Key constants (Key.SELECT, Key.PLAY_PAUSE, ...). Raw platform keycodes are not accepted.',
      docs: docsLink('core/remote'),
    });
  }
}

function assertCount(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new DpadError(
      'INVALID_ARGUMENT',
      `${name} must be a non-negative integer, got ${value}.`,
      {
        docs: docsLink('core/remote'),
      },
    );
  }
}

const describeHold = (holdMs: number | undefined): string =>
  holdMs === undefined ? '' : ` ${holdMs}ms`;

/**
 * The remote: semantic keys only. Every press goes through key overrides, then a capability
 * check, then the driver; each press is one reported step.
 */
export class RemoteImpl implements Remote {
  constructor(private readonly ctx: RuntimeContext) {}

  async press(key: Key, opts?: PressOptions): Promise<void> {
    assertKey(key);
    const override = this.ctx.keyOverrides[key];
    const performed = override?.as ?? key;
    const holdMs = override?.holdMs ?? opts?.holdMs;
    const performedAs = override
      ? `${holdMs === undefined ? 'press' : 'hold'} ${performed}${describeHold(holdMs)}`
      : undefined;

    this.checkSupported(key, performed, holdMs, performedAs);

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
    const interval = opts?.intervalMs ?? this.ctx.remote.intervalMs;
    await this.ctx.step({ kind: 'sequence', title: `sequence ${keys.join(', ')}` }, async () => {
      for (const [i, key] of keys.entries()) {
        if (i > 0) await sleep(interval);
        await this.press(key);
      }
    });
  }

  private checkSupported(
    key: Key,
    performed: Key,
    holdMs: number | undefined,
    performedAs: string | undefined,
  ): void {
    const platform = this.ctx.target.driver.platform;
    const caps = this.ctx.target.capabilities;
    const needed = KEY_CAPABILITY[performed];
    const via = performedAs ? ` (performed as ${performedAs} by a key override)` : '';
    if (needed && !caps.has(needed)) {
      throw new DpadError(
        'KEY_UNSUPPORTED',
        `${platform} has no ${performed} key${via}: it needs capability '${needed}'.`,
        {
          hint: performedAs
            ? `Fix the key override for ${key} in the dpad config so it uses a key this platform has.`
            : `Declare requires('${needed}') on the test so it is skipped here, or, if the app maps this action to another gesture on ${platform}, add a key override for ${key}.`,
          docs: docsLink('core/remote'),
        },
      );
    }
    if (holdMs !== undefined && !caps.has('key.longpress')) {
      throw new DpadError(
        'KEY_UNSUPPORTED',
        `${platform} cannot hold keys${via}: long presses need capability 'key.longpress'.`,
        {
          hint: `Declare requires('key.longpress') on the test so it is skipped here.`,
          docs: docsLink('core/remote'),
        },
      );
    }
  }
}
