import type { BusyResource } from '@dpad-tv/protocol';
import type { IdleTracker } from '../idle.js';
import { describeElement } from './dom.js';

/** Decides whether a running animation should be ignored for idle (return true to ignore). */
export type AnimationFilter = (animation: Animation) => boolean;

/**
 * Tracks CSS animations and transitions. Uses `document.getAnimations()` where available;
 * older engines fall back to animation/transition events. Infinite animations (spinners,
 * marquees, carousels) are never tracked: they would keep the app busy forever.
 */
export function trackAnimations(
  tracker: IdleTracker,
  opts: { ignore?: AnimationFilter | undefined; testIdAttribute: string },
): () => void {
  if (typeof document === 'undefined') return () => {};
  const doc = document as Document & { getAnimations?: () => Animation[] };
  if (typeof doc.getAnimations === 'function') {
    return tracker.addProbe(() => {
      const out: BusyResource[] = [];
      const animations = doc.getAnimations!();
      for (let i = 0; i < animations.length; i++) {
        const a = animations[i] as Animation;
        if (a.playState !== 'running') continue;
        const effect = a.effect as (AnimationEffect & { target?: Element | null }) | null;
        const timing =
          effect && typeof effect.getComputedTiming === 'function'
            ? effect.getComputedTiming()
            : null;
        if (timing && timing.iterations === Infinity) continue;
        if (opts.ignore && safeIgnore(opts.ignore, a)) continue;
        out.push({
          kind: 'animation',
          description: describeAnimation(a, effect?.target, opts.testIdAttribute),
        });
      }
      return out;
    });
  }
  return trackAnimationEvents(tracker, opts.testIdAttribute);
}

function describeAnimation(a: Animation, target: Element | null | undefined, attr: string): string {
  const css = a as Animation & { animationName?: string; transitionProperty?: string };
  const on = describeElement(target, attr);
  if (css.animationName) return `animation ${css.animationName} on ${on}`;
  if (css.transitionProperty) return `transition ${css.transitionProperty} on ${on}`;
  return `animation on ${on}`;
}

function safeIgnore(filter: AnimationFilter, a: Animation): boolean {
  try {
    return filter(a);
  } catch {
    return false;
  }
}

/** Event-based fallback. Tokens auto-expire after 5s in case an end event never fires. */
function trackAnimationEvents(tracker: IdleTracker, attr: string): () => void {
  const active = new Map<string, () => void>();
  const keyOf = (target: EventTarget | null, name: string): string => `${name}@${idFor(target)}`;
  const ids = new WeakMap<object, number>();
  let next = 1;
  const idFor = (target: EventTarget | null): number => {
    if (!target) return 0;
    let id = ids.get(target);
    if (id === undefined) {
      id = next++;
      ids.set(target, id);
    }
    return id;
  };
  const start = (kind: 'animation' | 'transition') => (e: Event) => {
    const ev = e as AnimationEvent & TransitionEvent;
    const name = kind === 'animation' ? ev.animationName : ev.propertyName;
    const el = e.target as Element | null;
    if (kind === 'animation' && el && typeof getComputedStyle === 'function') {
      const count = getComputedStyle(el).animationIterationCount || '';
      if (count.indexOf('infinite') >= 0) return;
    }
    const key = keyOf(e.target, `${kind}:${name}`);
    if (active.has(key)) return;
    const release = tracker.begin(
      'animation',
      `${kind} ${name} on ${describeElement(el, attr)}`,
      5000,
    );
    active.set(key, release);
  };
  const end = (kind: 'animation' | 'transition') => (e: Event) => {
    const ev = e as AnimationEvent & TransitionEvent;
    const name = kind === 'animation' ? ev.animationName : ev.propertyName;
    const key = keyOf(e.target, `${kind}:${name}`);
    const release = active.get(key);
    if (release) {
      active.delete(key);
      release();
    }
  };
  const listeners: Array<[string, (e: Event) => void]> = [
    ['animationstart', start('animation')],
    ['webkitAnimationStart', start('animation')],
    ['animationend', end('animation')],
    ['webkitAnimationEnd', end('animation')],
    ['animationcancel', end('animation')],
    ['transitionrun', start('transition')],
    ['transitionstart', start('transition')],
    ['transitionend', end('transition')],
    ['webkitTransitionEnd', end('transition')],
    ['transitioncancel', end('transition')],
  ];
  for (const [type, fn] of listeners) document.addEventListener(type, fn, true);
  return () => {
    for (const [type, fn] of listeners) document.removeEventListener(type, fn, true);
    active.forEach((release) => release());
    active.clear();
  };
}
