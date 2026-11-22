/**
 * Polling helpers.
 *
 * TODO(core): replace with the core retry engine (timeouts, SDK idle integration per decision
 * 16) once S1 merges. Until then this is plain polling, which is correct but slower than idle.
 */

export const POLL_INTERVAL_MS = 50;

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls `probe` until it returns `done: true` or `timeoutMs` passes. Always probes at least once
 * and once more at the deadline. Returns the last value and whether it finished in time.
 */
export async function poll<T>(
  probe: () => Promise<{ done: boolean; value: T }>,
  timeoutMs: number,
): Promise<{ done: boolean; value: T; elapsedMs: number }> {
  const start = Date.now();
  for (;;) {
    const { done, value } = await probe();
    const elapsedMs = Date.now() - start;
    if (done || elapsedMs >= timeoutMs) return { done, value, elapsedMs };
    await delay(Math.min(POLL_INTERVAL_MS, timeoutMs - elapsedMs));
  }
}
