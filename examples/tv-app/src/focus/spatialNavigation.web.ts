/**
 * Minimal spatial navigation for the web build, mirroring the native TV focus engines:
 * arrow keys move focus to the nearest focusable element in that direction, and entering a
 * `FocusGroup` (`data-focus-group`) restores the element focused there last (first visit: the
 * first focusable child), like `TVFocusGuideView autoFocus`.
 */

type Direction = 'up' | 'down' | 'left' | 'right';

const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

const FOCUSABLE = '[tabindex="0"]';
const GROUP = '[data-focus-group]';

const memory = new WeakMap<Element, HTMLElement>();

function isVisible(el: Element): boolean {
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function focusables(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
}

function groupsOf(el: Element): Element[] {
  const groups: Element[] = [];
  for (let group = el.closest(GROUP); group; group = group.parentElement?.closest(GROUP) ?? null) {
    groups.push(group);
  }
  return groups;
}

/** Lower is better; `null` when `to` is not in `direction` from `from`. */
function score(from: DOMRect, to: DOMRect, direction: Direction): number | null {
  const fromCx = from.left + from.width / 2;
  const fromCy = from.top + from.height / 2;
  const toCx = to.left + to.width / 2;
  const toCy = to.top + to.height / 2;
  const horizontal = direction === 'left' || direction === 'right';

  const ahead =
    direction === 'right'
      ? toCx > from.right
      : direction === 'left'
        ? toCx < from.left
        : direction === 'down'
          ? toCy > from.bottom
          : toCy < from.top;
  if (!ahead) return null;

  const primary = Math.max(
    0,
    direction === 'right'
      ? to.left - from.right
      : direction === 'left'
        ? from.left - to.right
        : direction === 'down'
          ? to.top - from.bottom
          : from.top - to.bottom,
  );
  const overlap = horizontal
    ? Math.min(from.bottom, to.bottom) - Math.max(from.top, to.top)
    : Math.min(from.right, to.right) - Math.max(from.left, to.left);
  const offAxis = horizontal ? Math.abs(toCy - fromCy) : Math.abs(toCx - fromCx);
  return primary + (overlap > 0 ? 0 : offAxis * 2) + offAxis * 0.1;
}

function findNext(current: HTMLElement, direction: Direction): HTMLElement | null {
  const from = current.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const candidate of focusables()) {
    if (candidate === current) continue;
    const s = score(from, candidate.getBoundingClientRect(), direction);
    if (s !== null && s < bestScore) {
      best = candidate;
      bestScore = s;
    }
  }
  return best;
}

/** Redirects into the outermost group being entered: its remembered element or first child. */
function redirect(current: HTMLElement, next: HTMLElement): HTMLElement {
  const entered = groupsOf(next).filter((group) => !group.contains(current));
  const outermost = entered.at(-1);
  if (!outermost) return next;
  const remembered = memory.get(outermost);
  if (remembered && outermost.contains(remembered) && isVisible(remembered)) return remembered;
  return focusables(outermost)[0] ?? next;
}

function onFocusIn(event: FocusEvent): void {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  for (const group of groupsOf(target)) memory.set(group, target);
}

function onKeyDown(event: KeyboardEvent): void {
  const direction = KEY_TO_DIRECTION[event.key];
  if (!direction || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey)
    return;
  const active = document.activeElement;
  const current =
    active instanceof HTMLElement && active.matches(FOCUSABLE) && isVisible(active) ? active : null;
  event.preventDefault();
  if (!current) {
    focusables()[0]?.focus();
    return;
  }
  const next = findNext(current, direction);
  if (next) redirect(current, next).focus();
}

/** Installs the key and focus listeners; returns an uninstaller. */
export function installSpatialNavigation(): () => void {
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('focusin', onFocusIn);
  return () => {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('focusin', onFocusIn);
  };
}
