/**
 * What holds focus: a host instance (what refs and `event.target` point at) or a native tag
 * (old architecture events, `findNodeHandle()`).
 */
export type FocusTarget = object | number;

/**
 * Remembers the focused host view. Fed by focus/blur events captured at the app root (both
 * Android and tvOS dispatch them for every native view) and by `reportFocus()` for focus
 * engines that do not move native focus.
 */
export class FocusTracker {
  private target: FocusTarget | null = null;
  /** Called after every change. */
  onChange: (() => void) | null = null;

  get current(): FocusTarget | null {
    return this.target;
  }

  focus(target: unknown): void {
    const t = asTarget(target);
    if (t === null) return;
    this.target = t;
    this.onChange?.();
  }

  /** Clears focus when `target` is the focused view (blur and focus may arrive in any order). */
  blur(target: unknown): void {
    const t = asTarget(target);
    if (t === null || this.target === null || !sameTarget(t, this.target)) return;
    this.target = null;
    this.onChange?.();
  }

  /** Replaces the focused view (`null` = nothing focused). */
  set(target: unknown): void {
    this.target = asTarget(target);
    this.onChange?.();
  }
}

/** Native tag of a host instance or tag, when it has one. */
export function targetTag(target: FocusTarget): number | undefined {
  if (typeof target === 'number') return target;
  const t = target as { __nativeTag?: unknown; _nativeTag?: unknown; nativeTag?: unknown };
  const tag = t.__nativeTag ?? t._nativeTag ?? t.nativeTag;
  return typeof tag === 'number' ? tag : undefined;
}

export function sameTarget(a: FocusTarget, b: FocusTarget): boolean {
  if (a === b) return true;
  const ta = targetTag(a);
  return ta !== undefined && ta === targetTag(b);
}

function asTarget(value: unknown): FocusTarget | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null) {
    // A ref object: `reportFocus(ref)` as well as `reportFocus(ref.current)`.
    if ('current' in value) return asTarget((value as { current?: unknown }).current);
    return value;
  }
  return null;
}
