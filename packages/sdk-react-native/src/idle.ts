import { getToets, type IdleTracker } from '@toets/sdk';

/** Safety net: an animation whose end callback never fires stops counting after this long. */
const ANIMATION_MAX_MS = 10_000;
const NAVIGATION_MAX_MS = 5_000;

type AnyFn = (...args: never[]) => unknown;
type Composite = { start?: (callback?: unknown, isLooping?: boolean) => unknown };

/**
 * Tracks `Animated.timing`, `Animated.spring` and `Animated.decay` animations (JS and native
 * driver) as busy until their end callback runs. Infinite `Animated.loop`s are not tracked:
 * they never settle (decision 16). Composites (`sequence`, `parallel`, `stagger`) are covered
 * through their children.
 */
export function instrumentAnimated(idle: IdleTracker, animated: unknown): () => void {
  const target = animated as Record<string, unknown> | null | undefined;
  if (!target) return noop;
  const restore: Array<() => void> = [];
  for (const name of ['timing', 'spring', 'decay']) {
    const original = target[name];
    if (typeof original !== 'function') continue;
    const wrapped = function (this: unknown, ...args: unknown[]): unknown {
      const animation = (original as (...a: unknown[]) => unknown).apply(this, args) as Composite;
      if (animation && typeof animation.start === 'function') {
        const start = animation.start;
        const config = args[1] as { duration?: unknown } | undefined;
        const description =
          name === 'timing' && config && typeof config.duration === 'number'
            ? `Animated.timing ${config.duration}ms`
            : `Animated.${name}`;
        animation.start = function (this: unknown, callback?: unknown, isLooping?: boolean) {
          if (isLooping === true || idle.isUntracked) return start.call(this, callback, isLooping);
          const done = idle.begin('animation', description, ANIMATION_MAX_MS);
          return start.call(
            this,
            (result: unknown) => {
              done();
              if (typeof callback === 'function') (callback as (r: unknown) => void)(result);
            },
            isLooping,
          );
        };
      }
      return animation;
    };
    try {
      target[name] = wrapped;
    } catch {
      continue;
    }
    restore.push(() => {
      if (target[name] === wrapped) target[name] = original;
    });
  }
  return () => restore.forEach((r) => r());
}

/**
 * Tracks `InteractionManager` handles as busy, on React Native versions that still have it.
 * Accessing the removed module throws in development builds of newer versions, so the
 * caller passes a getter.
 */
export function instrumentInteractionManager(
  idle: IdleTracker,
  getInteractionManager: () => unknown,
): () => void {
  let im: Record<string, unknown> | null;
  try {
    im = (getInteractionManager() as Record<string, unknown> | null | undefined) ?? null;
  } catch {
    im = null;
  }
  if (!im || typeof im.createInteractionHandle !== 'function') return noop;
  if (typeof im.clearInteractionHandle !== 'function') return noop;
  const create = im.createInteractionHandle as AnyFn;
  const clear = im.clearInteractionHandle as (handle: unknown) => void;
  const open = new Map<unknown, () => void>();
  const target = im;
  const wrappedCreate = function (this: unknown): unknown {
    const handle = create.call(this);
    open.set(handle, idle.begin('interaction', 'InteractionManager handle', ANIMATION_MAX_MS));
    return handle;
  };
  const wrappedClear = function (this: unknown, handle: unknown): void {
    open.get(handle)?.();
    open.delete(handle);
    clear.call(this, handle);
  };
  target.createInteractionHandle = wrappedCreate;
  target.clearInteractionHandle = wrappedClear;
  return () => {
    if (target.createInteractionHandle === wrappedCreate) target.createInteractionHandle = create;
    if (target.clearInteractionHandle === wrappedClear) target.clearInteractionHandle = clear;
    open.forEach((done) => done());
    open.clear();
  };
}

/** Listener map for React Navigation's `screenListeners`. */
export interface NavigationIdleListeners {
  transitionStart(event: { target?: string }): void;
  transitionEnd(event: { target?: string }): void;
}

/**
 * Marks screen transitions busy. Pass to a stack navigator's `screenListeners`; works with
 * any navigator that emits `transitionStart`/`transitionEnd`.
 *
 * @example
 * <Stack.Navigator screenListeners={navigationIdleListeners()}>
 */
export function navigationIdleListeners(): NavigationIdleListeners {
  const open: Record<string, () => void> = {};
  return {
    transitionStart(event) {
      const toets = getToets();
      if (!toets) return;
      const key = (event && event.target) || 'screen';
      open[key]?.();
      open[key] = toets.idle.begin('navigation', `transition ${key}`, NAVIGATION_MAX_MS);
    },
    transitionEnd(event) {
      const key = (event && event.target) || 'screen';
      const done = open[key];
      delete open[key];
      done?.();
    },
  };
}

function noop(): void {}
