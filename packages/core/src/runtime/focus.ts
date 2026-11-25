import type { Focus, Locator, NavigateOptions, PressUntilFocusedOptions } from '../api.js';
import { ToetsError, packageDocsLink } from '../errors.js';
import { DIRECTION_KEY, type Direction, type DirectionKey } from '../keys.js';
import type { ElementRef, ElementSnapshot, Rect } from '../snapshot.js';
import type { RuntimeContext } from './context.js';
import {
  createLocator,
  describeElement,
  locatorImpl,
  strictModeError,
  type LocatorImpl,
} from './locator.js';
import type { RemoteImpl } from './remote.js';
import type { Target } from './target.js';
import { sleep } from './retry.js';

const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];
const DIRECTION_KEYS: ReadonlySet<string> = new Set(Object.values(DIRECTION_KEY));
const SETTLE_POLL_MS = 50;
const DEFAULT_MAX_PRESSES = 50;
/** Elements of the focus path shown in error messages (the most recent ones). */
const PATH_SHOWN = 10;

/**
 * Identity of a focused element across presses: its ref plus its test ID and text. Some
 * drivers derive refs from tree positions, so a list that scrolls under a fixed focus position
 * keeps the ref while the focused item changes.
 */
type FocusKey = string & { readonly __focusKey: unique symbol };

function focusKey(el: ElementSnapshot): FocusKey {
  return JSON.stringify([el.ref, el.testId, el.text]) as FocusKey;
}

const sameFocus = (a: ElementSnapshot | null, b: ElementSnapshot | null): boolean =>
  a === null || b === null ? a === b : focusKey(a) === focusKey(b);

/**
 * Waits after a key press until the app is idle (SDK `sync.idle`), focus left `from`, or
 * `settleMs` passed. How `navigateTo` lets a press land before reading focus again; runners
 * use it to report where focus landed.
 */
export async function settleFocus(
  target: Target,
  from: ElementRef | undefined,
  settleMs: number,
): Promise<void> {
  const idle = await target.waitForIdle(settleMs);
  if (idle.supported && idle.idle) return;
  const deadline = performance.now() + settleMs;
  while (performance.now() < deadline) {
    const now = await target.focused();
    if (now?.ref !== from) return;
    await sleep(SETTLE_POLL_MS);
  }
}

/**
 * Focus after a press that has to move it. Idle (SDK) lets the app finish reacting first; then
 * focus is polled until it lands on another element or `settleMs` passed, so a slow app is never
 * reported as stuck early. Returns the element holding focus at the end: `before` (or `null`
 * when focus is lost) means the press did not move it.
 */
async function focusAfterPress(
  target: Target,
  before: ElementSnapshot,
  settleMs: number,
): Promise<ElementSnapshot | null> {
  const deadline = performance.now() + settleMs;
  await target.waitForIdle(settleMs);
  for (;;) {
    const now = await target.focused();
    if ((now && !sameFocus(now, before)) || performance.now() >= deadline) return now;
    await sleep(SETTLE_POLL_MS);
  }
}

const center = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/**
 * Directions to try from `from` toward `to`, best first. Same row: horizontal. Same column:
 * vertical. Otherwise vertical first (TV screens are stacks of rows), then horizontal. The
 * remaining directions follow as a last resort for detours.
 */
export function rankDirections(from: Rect, to: Rect): Direction[] {
  const a = center(from);
  const b = center(to);
  const h: Direction | null = b.x > a.x ? 'right' : b.x < a.x ? 'left' : null;
  const v: Direction | null = b.y > a.y ? 'down' : b.y < a.y ? 'up' : null;
  const sameRow = from.y < to.y + to.height && to.y < from.y + from.height;
  const sameColumn = from.x < to.x + to.width && to.x < from.x + from.width;
  const ranked: Direction[] = [];
  const add = (d: Direction | null) => {
    if (d && !ranked.includes(d)) ranked.push(d);
  };
  if (sameRow) add(h);
  else if (sameColumn) add(v);
  add(v);
  add(h);
  DIRECTIONS.forEach(add);
  return ranked;
}

/** Directions that reduce the distance to `to`, best first (a prefix of {@link rankDirections}). */
export function towardDirections(from: Rect, to: Rect): Direction[] {
  const a = center(from);
  const b = center(to);
  return rankDirections(from, to).filter(
    (d) =>
      (d === 'up' && b.y < a.y) ||
      (d === 'down' && b.y > a.y) ||
      (d === 'left' && b.x < a.x) ||
      (d === 'right' && b.x > a.x),
  );
}

interface Visit {
  bounds: Rect;
  readonly tried: Set<Direction>;
  /** Observed moves; a press that did not move focus maps to the element itself. */
  readonly moves: Map<Direction, FocusKey>;
}

/** First step along observed moves to the nearest other element satisfying `wanted`. */
function walkToward(
  visits: ReadonlyMap<FocusKey, Visit>,
  from: FocusKey,
  wanted: (v: Visit) => boolean,
): Direction | null {
  const firstStep = new Map<FocusKey, Direction>();
  const queue: FocusKey[] = [from];
  const seen = new Set([from]);
  while (queue.length) {
    const key = queue.shift() as FocusKey;
    for (const [d, next] of visits.get(key)?.moves ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      const step = key === from ? d : (firstStep.get(key) as Direction);
      const visit = visits.get(next);
      if (!visit || wanted(visit)) return step; // unvisited elements are unexplored
      firstStep.set(next, step);
      queue.push(next);
    }
  }
  return null;
}

/** `a → b → c`, the last {@link PATH_SHOWN} elements focus passed through. */
function describePath(path: readonly ElementSnapshot[]): string {
  const shown = path.slice(-PATH_SHOWN).map(describeElement);
  if (path.length > PATH_SHOWN) shown.unshift('…');
  return shown.join(' → ');
}

const times = (n: number) => (n === 1 ? 'once' : `${n} times`);

export class FocusImpl implements Focus {
  constructor(
    private readonly ctx: RuntimeContext,
    private readonly remote: RemoteImpl,
  ) {}

  current(): Locator {
    return createLocator(this.ctx, [{ kind: 'focused' }]);
  }

  async pressUntilFocused(
    key: DirectionKey,
    target: Locator,
    opts?: PressUntilFocusedOptions,
  ): Promise<number> {
    if (typeof key !== 'string' || !DIRECTION_KEYS.has(key)) {
      throw new ToetsError(
        'INVALID_ARGUMENT',
        `pressUntilFocused() presses a direction key (Key.UP, Key.DOWN, Key.LEFT, Key.RIGHT), got ${JSON.stringify(key)}.`,
        { docs: packageDocsLink('core', 'focus-navigation') },
      );
    }
    const goal = this.goal(target, 'pressUntilFocused');
    const maxPresses = this.maxPresses(opts?.maxPresses);
    return this.ctx.step(
      { kind: 'pressUntilFocused', title: `pressUntilFocused ${key} ${goal.description}` },
      async () => {
        let focused = await this.waitForFocus();
        const path = [focused];
        const seen = new Set([focusKey(focused)]);
        for (let presses = 0; ;) {
          if (await this.holdsFocus(goal)) return presses;
          const pressed = () => `Pressed ${key} ${times(presses)} toward ${goal.description}`;
          const docs = packageDocsLink('core', 'focus-navigation');
          if (presses >= maxPresses) {
            throw new ToetsError(
              'FOCUS_UNREACHABLE',
              `${pressed()} and gave up after maxPresses (${maxPresses}). Path: ${describePath(path)}.`,
              {
                hint: `The target may be more than ${maxPresses} presses away (raise maxPresses), or not in this direction. Check its locator and the screen in app.snapshot().`,
                docs,
              },
            );
          }
          await this.remote.press(key);
          presses++;
          const settleMs = this.ctx.timeouts.navigationSettleMs;
          const after = await focusAfterPress(this.ctx.target, focused, settleMs);
          if (!after) {
            throw new ToetsError(
              'NO_FOCUS',
              `${pressed()}: nothing holds focus after the last press. Path: ${describePath(path)}.`,
              {
                hint: 'The press moved focus out of the app, or onto something the platform does not report. Check the screen in app.snapshot().',
                docs,
              },
            );
          }
          if (sameFocus(after, focused)) {
            throw new ToetsError(
              'FOCUS_STUCK',
              `${pressed()}: focus stayed on ${describeElement(after)} for ${settleMs}ms after the last press. Path: ${describePath(path)}.`,
              {
                hint: `Focus cannot move ${key} from here: the end of a row or list, a focus trap, or a disabled target. Check the direction, that the target is enabled, and the screen in app.snapshot().`,
                docs,
              },
            );
          }
          path.push(after);
          if (seen.has(focusKey(after))) {
            throw new ToetsError(
              'FOCUS_LOOP',
              `${pressed()}: focus came back to ${describeElement(after)}, so ${key} cycles without reaching the target. Path: ${describePath(path)}.`,
              {
                hint: 'The target is not on this path (a wrap-around row or menu). Check its locator, that it is enabled and visible, or press another direction.',
                docs,
              },
            );
          }
          seen.add(focusKey(after));
          focused = after;
        }
      },
    );
  }

  async navigateTo(target: Locator, opts?: NavigateOptions): Promise<readonly Direction[]> {
    const goal = this.goal(target, 'navigateTo');
    const maxPresses = this.maxPresses(opts?.maxPresses);
    return this.ctx.step({ kind: 'navigate', title: `navigateTo ${goal.description}` }, () =>
      this.navigate(goal, maxPresses),
    );
  }

  private goal(target: Locator, method: string): LocatorImpl {
    const goal = locatorImpl(target);
    if (!goal) {
      throw new ToetsError('INVALID_ARGUMENT', `${method}() needs a toets Locator.`, {
        docs: packageDocsLink('core', 'focus-navigation'),
      });
    }
    return goal;
  }

  private maxPresses(value: number | undefined): number {
    if (value === undefined) return DEFAULT_MAX_PRESSES;
    if (!Number.isInteger(value) || value < 1) {
      throw new ToetsError(
        'INVALID_ARGUMENT',
        `maxPresses must be a positive integer, got ${value}.`,
        { docs: packageDocsLink('core', 'focus-navigation') },
      );
    }
    return value;
  }

  /** Whether `goal` (strict: at most one match) or an element inside it holds focus. */
  private async holdsFocus(goal: LocatorImpl): Promise<boolean> {
    const matches = await goal.resolve();
    if (matches.length > 1) throw strictModeError(goal.chain, matches);
    const el = matches[0];
    return !!el && (el.focused || el.focusWithin);
  }

  /**
   * Online search with real presses. Every observed move is learned; each (element, direction)
   * pair is tried at most once, so the search always ends. Order of preference: an untried
   * direction toward the target; walking observed moves back to the nearest element that still
   * has one; an untried detour; walking to any element with an untried direction.
   */
  private async navigate(goal: LocatorImpl, maxPresses: number): Promise<readonly Direction[]> {
    const path: Direction[] = [];
    const visits = new Map<FocusKey, Visit>();

    for (;;) {
      const el = await this.onScreen(goal);
      if (el.focused || el.focusWithin) return path;

      const focused = await this.waitForFocus();
      if (path.length >= maxPresses) {
        throw this.unreachable(goal, focused, path, `gave up after ${maxPresses} presses`);
      }
      const here = focusKey(focused);
      const visit = visits.get(here) ?? {
        bounds: focused.bounds,
        tried: new Set(),
        moves: new Map(),
      };
      visit.bounds = focused.bounds;
      visits.set(here, visit);

      const direction = this.chooseDirection(here, el.bounds, visits);
      if (!direction) throw this.unreachable(goal, focused, path, 'no untried direction is left');
      visit.tried.add(direction);
      await this.remote.press(DIRECTION_KEY[direction]);
      path.push(direction);
      await settleFocus(this.ctx.target, focused.ref, this.ctx.timeouts.navigationSettleMs);
      const after = await this.ctx.target.focused();
      visit.moves.set(direction, after ? focusKey(after) : here);
    }
  }

  /** The target, which navigateTo aims at by its bounds. */
  private async onScreen(goal: LocatorImpl): Promise<ElementSnapshot> {
    try {
      return await goal.resolveOne();
    } catch (e) {
      if (!(e instanceof ToetsError) || e.code !== 'ELEMENT_NOT_FOUND') throw e;
      throw new ToetsError('ELEMENT_NOT_FOUND', e.message, {
        hint: 'navigateTo aims at the target on screen. For an item that appears only as focus comes near (virtualized lists), press toward it with app.focus.pressUntilFocused(key, target).',
        docs: packageDocsLink('core', 'focus-navigation'),
        cause: e,
      });
    }
  }

  private async waitForFocus(): Promise<ElementSnapshot> {
    const result = await this.ctx.retry(async () => {
      const f = await this.ctx.target.focused();
      return { ok: f !== null, value: f };
    }, this.ctx.timeouts.actionMs);
    if (result.value) return result.value;
    throw new ToetsError('NO_FOCUS', 'Nothing is focused, so focus cannot be moved.', {
      hint: 'Launch the app and wait until it is ready (e.g. expect(app.focus.current()).toBeVisible()) before moving focus.',
      docs: packageDocsLink('core', 'focus-navigation'),
    });
  }

  private chooseDirection(
    from: FocusKey,
    goal: Rect,
    visits: ReadonlyMap<FocusKey, Visit>,
  ): Direction | null {
    const here = visits.get(from) as Visit;
    const toward = (v: Visit) => towardDirections(v.bounds, goal).filter((d) => !v.tried.has(d));
    const any = (v: Visit) => rankDirections(v.bounds, goal).filter((d) => !v.tried.has(d));
    return (
      toward(here)[0] ??
      walkToward(visits, from, (v) => toward(v).length > 0) ??
      any(here)[0] ??
      walkToward(visits, from, (v) => any(v).length > 0)
    );
  }

  private unreachable(
    goal: LocatorImpl,
    focused: ElementSnapshot,
    path: readonly Direction[],
    reason: string,
  ): ToetsError {
    return new ToetsError(
      'FOCUS_UNREACHABLE',
      `Could not move focus to ${goal.description}: ${reason}. Focus is on ${describeElement(focused)}. Path: ${path.length ? path.join(', ') : '(none)'}.`,
      {
        hint: 'The target may be disabled, hidden, behind a focus trap, or not reachable with the D-pad from here. Inspect app.snapshot(), or press toward it with app.focus.pressUntilFocused(key, target) for clear stuck and loop errors.',
        docs: packageDocsLink('core', 'focus-navigation'),
      },
    );
  }

  async waitForChange(action: () => Promise<void>, opts?: { timeoutMs?: number }): Promise<void> {
    const timeoutMs = opts?.timeoutMs ?? this.ctx.timeouts.actionMs;
    await this.ctx.step({ kind: 'waitForFocusChange', title: 'focus.waitForChange' }, async () => {
      const before = await this.ctx.target.focused();
      await action();
      const result = await this.ctx.retry(async () => {
        const now = await this.ctx.target.focused();
        return { ok: (now?.ref ?? null) !== (before?.ref ?? null), value: now };
      }, timeoutMs);
      if (!result.ok) {
        throw new ToetsError(
          'FOCUS_UNCHANGED',
          `Focus stayed on ${describeElement(before)} for ${timeoutMs}ms after the action.`,
          {
            hint: 'The action did not move focus. Check the key and the screen state; raise timeoutMs only if the app is known to react slowly.',
            docs: packageDocsLink('core', 'focus-navigation'),
          },
        );
      }
    });
  }
}
