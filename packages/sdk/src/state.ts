import { RpcError, RpcErrorCode, type LaunchFlags } from '@toets/protocol';
import type { IdleTracker } from './idle.js';

/**
 * Applies a named app state and/or flags. Runs at launch (with the payload's `state` and
 * `flags`) and on every `state.apply` from the host. The app stays busy until the returned
 * promise settles, so the host waits for the state to be applied.
 */
export type StateHandler = (state: string | undefined, flags: LaunchFlags) => void | Promise<void>;

/** Backs the `state` domain: `onState` handlers, launch state, `state.apply`. */
export class StateRegistry {
  private readonly handlers: StateHandler[] = [];
  private readonly tracker: IdleTracker;
  private readonly launch: { state: string | undefined; flags: LaunchFlags } | null;
  private readonly onError: (message: string, error: unknown) => void;

  constructor(
    tracker: IdleTracker,
    launch: { state?: string | undefined; flags?: LaunchFlags | undefined },
    onError: (message: string, error: unknown) => void,
  ) {
    this.tracker = tracker;
    this.onError = onError;
    const hasFlags = !!launch.flags && Object.keys(launch.flags).length > 0;
    this.launch =
      launch.state !== undefined || hasFlags
        ? { state: launch.state, flags: launch.flags ?? {} }
        : null;
  }

  /** Registers a handler; it immediately receives the launch state, if any. */
  add(handler: StateHandler): () => void {
    this.handlers.push(handler);
    const launch = this.launch;
    if (launch) {
      const release = this.tracker.begin(
        'state',
        `launch state ${describe(launch.state, launch.flags)}`,
      );
      Promise.resolve()
        .then(() => handler(launch.state, launch.flags))
        .then(release, (error: unknown) => {
          release();
          this.onError(
            `onState handler failed for launch state ${describe(launch.state, launch.flags)}`,
            error,
          );
        });
    }
    return () => {
      const i = this.handlers.indexOf(handler);
      if (i >= 0) this.handlers.splice(i, 1);
    };
  }

  /** Runs every handler in registration order. Throws `RpcError` (HandlerFailed) on failure. */
  async apply(state: string | undefined, flags: LaunchFlags): Promise<void> {
    if (this.handlers.length === 0) {
      throw new RpcError(
        RpcErrorCode.HandlerFailed,
        'No onState handler is registered in the app; register one with onState() to support app states.',
      );
    }
    const release = this.tracker.begin('state', `state ${describe(state, flags)}`);
    try {
      for (const handler of this.handlers.slice()) await handler(state, flags);
    } catch (error) {
      throw new RpcError(
        RpcErrorCode.HandlerFailed,
        `onState handler failed for ${describe(state, flags)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      release();
    }
  }
}

function describe(state: string | undefined, flags: LaunchFlags): string {
  const names = Object.keys(flags);
  const s = state === undefined ? '(flags only)' : `"${state}"`;
  return names.length ? `${s} with flags ${names.join(', ')}` : s;
}
