/**
 * dpad web adapter: maps the DOM, `document.activeElement` focus, CSS animations and
 * `<video>`/`<audio>` players onto the protocol. Start it as early as possible, before
 * your router rewrites the URL. See `docs/web.md`.
 *
 * @example
 * import { startDpad } from '@dpad-tv/sdk/web';
 * startDpad(); // inert unless launched by dpad
 */
import { createDpad } from '../global.js';
import type { Dpad, DpadOptions } from '../runtime.js';
import { trackAnimations, type AnimationFilter } from './animations.js';
import { DomMapper, type DomMapperOptions } from './dom.js';
import { trackMediaElements } from './media.js';
import { discoverWebPayload } from './payload.js';

export * from '../index.js';
export { discoverWebPayload } from './payload.js';
export {
  DomMapper,
  describeElement,
  currentViewport,
  type DomMapperOptions,
  type FocusNeighbors,
} from './dom.js';
export { mediaElementSnapshot } from './media.js';
export type { AnimationFilter } from './animations.js';

export interface WebDpadOptions extends Partial<Omit<DpadOptions, 'payload'>>, DomMapperOptions {
  /** Payload override. Default: `window.__DPAD__` or the `__dpad` query parameter. */
  readonly payload?: unknown;
  /** Track CSS animations and transitions for idle. Default true. */
  readonly animations?: boolean;
  /** Animations to ignore for idle (return true), e.g. a background loop with finite iterations. */
  readonly ignoreAnimation?: AnimationFilter;
  /** Expose `<video>`/`<audio>` elements as media players. Default true. */
  readonly media?: boolean;
}

/**
 * Starts the SDK in a web app. Returns the runtime; it is inert (and installs nothing) when
 * the page was not launched by dpad.
 */
export function startDpad(options: WebDpadOptions = {}): Dpad {
  const payload = options.payload !== undefined ? options.payload : discoverWebPayload();
  const dpad = createDpad({ ...options, payload, framework: options.framework ?? 'web' });
  if (!dpad.active) return dpad;

  const testIdAttribute = options.testIdAttribute ?? 'data-testid';
  const mapper = new DomMapper(options);
  dpad.handle('tree.get', (p) => mapper.tree(p.rootId));
  dpad.handle('focus.get', () => ({ node: mapper.focused() }));
  dpad.handle('focus.graph', (p) => ({ nodes: mapper.graph(p.rootId) }));
  dpad.setFocusSource({ current: () => mapper.focusedId() });

  if (typeof document !== 'undefined') {
    const onFocus = (): void => dpad.focusChanged();
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('focusout', onFocus, true);
    dpad.onStop(() => {
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('focusout', onFocus, true);
    });
  }
  if (options.animations !== false) {
    dpad.onStop(trackAnimations(dpad.idle, { ignore: options.ignoreAnimation, testIdAttribute }));
  }
  if (options.media !== false) {
    dpad.onStop(trackMediaElements(dpad, { testIdAttribute, nodeId: (el) => mapper.idOf(el) }));
  }
  if (options.logs !== false) dpad.onStop(trackUncaught(dpad));
  dpad.start();
  return dpad;
}

function trackUncaught(dpad: Dpad): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function')
    return () => {};
  const onError = (e: ErrorEvent): void => {
    const stack = e.error instanceof Error ? e.error.stack : undefined;
    dpad.log(
      'error',
      `Uncaught ${e.message || String(e.error)}`,
      stack ? { kind: 'uncaught', stack } : { kind: 'uncaught' },
    );
  };
  const onRejection = (e: PromiseRejectionEvent): void => {
    const reason: unknown = e.reason;
    const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    dpad.log(
      'error',
      `Unhandled rejection: ${message}`,
      stack ? { kind: 'uncaught', stack } : { kind: 'uncaught' },
    );
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
