import { describe, expect, it, vi } from 'vitest';
import { DpadError } from '../src/index.js';
import { describeIdle, retry, type IdleCheck } from '../src/runtime/retry.js';

const noSync = { waitForIdle: async (): Promise<IdleCheck> => ({ supported: false }) };

describe('retry', () => {
  it('evaluates immediately without idle sync and retries until ok', async () => {
    let n = 0;
    const r = await retry(noSync, async () => ({ ok: ++n === 3, value: n }), {
      timeoutMs: 1000,
      idleBudgetMs: 100,
      intervals: [1],
    });
    expect(r).toMatchObject({ ok: true, value: 3, attempts: 3, idle: { kind: 'unsupported' } });
  });

  it('waits for idle before evaluating when the SDK supports it', async () => {
    const order: string[] = [];
    const ctx = {
      waitForIdle: async (budget: number): Promise<IdleCheck> => {
        order.push(`idle(${budget})`);
        return { supported: true, idle: true, busy: [] };
      },
    };
    const r = await retry(ctx, async () => (order.push('eval'), { ok: true, value: 1 }), {
      timeoutMs: 1000,
      idleBudgetMs: 200,
    });
    expect(order).toEqual(['idle(200)', 'eval']);
    expect(r.idle).toEqual({ kind: 'idle' });
  });

  it('falls back to polling and remembers the busy resource when never idle', async () => {
    const waitForIdle = vi.fn(async (): Promise<IdleCheck> => ({
      supported: true,
      idle: false,
      busy: [{ kind: 'network', description: 'GET /api/home' }],
    }));
    const r = await retry({ waitForIdle }, async () => ({ ok: false, value: 0 }), {
      timeoutMs: 50,
      idleBudgetMs: 10,
      intervals: [5],
    });
    expect(waitForIdle).toHaveBeenCalledTimes(1);
    expect(r.ok).toBe(false);
    expect(r.attempts).toBeGreaterThan(1);
    expect(describeIdle(r.idle)).toBe(
      'app never became idle within 10ms (busy: network GET /api/home); polled instead',
    );
  });

  it('propagates DpadErrors at once and retries other errors', async () => {
    await expect(
      retry(
        noSync,
        async () => {
          throw new DpadError('X', 'boom');
        },
        { timeoutMs: 1000, idleBudgetMs: 0 },
      ),
    ).rejects.toThrow('boom');

    let n = 0;
    const r = await retry(
      noSync,
      async () => {
        if (++n < 2) throw new Error('flaky');
        return { ok: true, value: n };
      },
      { timeoutMs: 1000, idleBudgetMs: 0, intervals: [1] },
    );
    expect(r.ok).toBe(true);
  });

  it('reports the last transient error on timeout', async () => {
    const r = await retry(
      noSync,
      async () => {
        throw new Error('driver down');
      },
      { timeoutMs: 20, idleBudgetMs: 0, intervals: [5] },
    );
    expect(r.ok).toBe(false);
    expect(String(r.error)).toContain('driver down');
  });
});
