/**
 * toets web adapter: maps the DOM, `document.activeElement` focus, CSS animations and
 * `<video>`/`<audio>` players onto the protocol. Start it as early as possible, before
 * your router rewrites the URL. See `docs/web.md`.
 *
 * @example
 * import { startToets } from '@toets/sdk/web';
 * startToets(); // inert unless launched by toets
 */
import { createToets } from '../global.js';
import type { Toets, ToetsOptions } from '../runtime.js';
import { trackAnimations, type AnimationFilter } from './animations.js';
import { DomMapper, type DomMapperOptions } from './dom.js';
import { trackMediaElements } from './media.js';
import { discoverWebPayload } from './payload.js';

export * from '../index.js';
export { discoverWebPayload } from './payload.js';
export { DomMapper, describeElement, currentViewport, type DomMapperOptions } from './dom.js';
export { mediaElementSnapshot } from './media.js';
export type { AnimationFilter } from './animations.js';

export interface WebToetsOptions extends Partial<Omit<ToetsOptions, 'payload'>>, DomMapperOptions {
  /** Payload override. Default: `window.__TOETS__` or the `__toets` query parameter. */
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
 * the page was not launched by toets.
 */
export function startToets(options: WebToetsOptions = {}): Toets {
  const payload = options.payload !== undefined ? options.payload : discoverWebPayload();
  const toets = createToets({ ...options, payload, framework: options.framework ?? 'web' });
  if (!toets.active) return toets;

  const testIdAttribute = options.testIdAttribute ?? 'data-testid';
  const mapper = new DomMapper(options, () => toets.reportedFocus);
  toets.handle('tree.get', (p) => mapper.tree(p.rootId));
  toets.handle('focus.get', () => ({ node: mapper.focused() }));
  toets.setFocusSource({ current: () => mapper.focusedId() });

  if (typeof document !== 'undefined') {
    const onFocus = (): void => toets.focusChanged();
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('focusout', onFocus, true);
    toets.onStop(() => {
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('focusout', onFocus, true);
    });
  }
  if (options.animations !== false) {
    toets.onStop(trackAnimations(toets.idle, { ignore: options.ignoreAnimation, testIdAttribute }));
  }
  if (options.media !== false) {
    toets.onStop(trackMediaElements(toets, { testIdAttribute, nodeId: (el) => mapper.idOf(el) }));
  }
  if (options.logs !== false) toets.onStop(trackUncaught(toets));
  toets.start();
  return toets;
}

function trackUncaught(toets: Toets): () => void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function')
    return () => {};
  const onError = (e: ErrorEvent): void => {
    const stack = e.error instanceof Error ? e.error.stack : undefined;
    toets.log(
      'error',
      `Uncaught ${e.message || String(e.error)}`,
      stack ? { kind: 'uncaught', stack } : { kind: 'uncaught' },
    );
  };
  const onRejection = (e: PromiseRejectionEvent): void => {
    const reason: unknown = e.reason;
    const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    toets.log(
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
