import type { FocusGraphNode } from '@dpad-tv/protocol';
import type { Focus, Locator, NavigateOptions } from '../api.js';
import { DpadError, docsLink } from '../errors.js';
import { DIRECTION_KEY, type Direction } from '../keys.js';
import type { ElementRef, ElementSnapshot, Rect } from '../snapshot.js';
import type { RuntimeContext } from './context.js';
import { createLocator, describeElement, locatorImpl, type LocatorImpl } from './locator.js';
import type { RemoteImpl } from './remote.js';
import { sleep } from './retry.js';
import { findNode, walkTree } from './tree.js';

const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];
const SETTLE_POLL_MS = 50;

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
  /** Observed transitions; a press that did not move focus maps to the element itself. */
  readonly edges: Map<Direction, ElementRef>;
}

/** First step along learned transitions to the nearest other element satisfying `wanted`. */
function walkToward(
  visits: ReadonlyMap<ElementRef, Visit>,
  from: ElementRef,
  wanted: (v: Visit) => boolean,
): Direction | null {
  const firstStep = new Map<ElementRef, Direction>();
  const queue: ElementRef[] = [from];
  const seen = new Set([from]);
  while (queue.length) {
    const ref = queue.shift() as ElementRef;
    for (const [d, next] of visits.get(ref)?.edges ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      const step = ref === from ? d : (firstStep.get(ref) as Direction);
      const visit = visits.get(next);
      if (!visit || wanted(visit)) return step; // unvisited elements are unexplored
      firstStep.set(next, step);
      queue.push(next);
    }
  }
  return null;
}

/**
 * First step of a shortest path through the SDK focus graph, or `null`. Only known edges are
 * followed: `null` (focus does not move) and absent (unknown) edges are not.
 */
export function nextStepInGraph(
  graph: readonly FocusGraphNode[],
  from: string,
  goals: ReadonlySet<string>,
): Direction | null {
  const byId = new Map(graph.map((n) => [n.id, n]));
  const firstStep = new Map<string, Direction>();
  const queue: string[] = [from];
  const seen = new Set([from]);
  while (queue.length) {
    const id = queue.shift() as string;
    const node = byId.get(id);
    if (!node) continue;
    for (const d of DIRECTIONS) {
      const next = node[d];
      if (!next || seen.has(next)) continue;
      seen.add(next);
      const step = id === from ? d : (firstStep.get(id) as Direction);
      if (goals.has(next)) return step;
      firstStep.set(next, step);
      queue.push(next);
    }
  }
  return null;
}

export class FocusImpl implements Focus {
  constructor(
    private readonly ctx: RuntimeContext,
    private readonly remote: RemoteImpl,
  ) {}

  current(): Locator {
    return createLocator(this.ctx, [{ kind: 'focused' }]);
  }

  async navigateTo(target: Locator, opts?: NavigateOptions): Promise<readonly Direction[]> {
    const goal = locatorImpl(target);
    if (!goal) {
      throw new DpadError('INVALID_ARGUMENT', 'navigateTo() needs a dpad Locator.', {
        docs: docsLink('core/focus-navigation'),
      });
    }
    const maxPresses = opts?.maxPresses ?? 50;
    return this.ctx.step({ kind: 'navigate', title: `navigateTo ${goal.description}` }, () =>
      this.navigate(goal, maxPresses),
    );
  }

  /**
   * Online search with real presses. Every observed transition is learned; each (element,
   * direction) pair is tried at most once, so the search always ends. Order of preference:
   * the SDK focus graph; an untried direction toward the target; walking known transitions back
   * to the nearest element that still has one; an untried detour; walking to any element with
   * an untried direction.
   */
  private async navigate(goal: LocatorImpl, maxPresses: number): Promise<readonly Direction[]> {
    const path: Direction[] = [];
    const visits = new Map<ElementRef, Visit>();
    let goals: ReadonlySet<string> | null = null;

    for (;;) {
      const el = await goal.resolveOne();
      if (el.focused || el.focusWithin) return path;
      goals ??= await this.focusTargets(goal, el);

      const focused = await this.waitForFocus();
      if (path.length >= maxPresses) {
        throw this.unreachable(goal, focused, path, `gave up after ${maxPresses} presses`);
      }
      const visit = visits.get(focused.ref) ?? {
        bounds: focused.bounds,
        tried: new Set(),
        edges: new Map(),
      };
      visit.bounds = focused.bounds;
      visits.set(focused.ref, visit);

      const direction = await this.chooseDirection(focused.ref, el.bounds, goals, visits);
      if (!direction) throw this.unreachable(goal, focused, path, 'no untried direction is left');
      visit.tried.add(direction);
      await this.remote.press(DIRECTION_KEY[direction]);
      path.push(direction);
      await this.settle(focused.ref);
      const after = await this.ctx.target.focused();
      visit.edges.set(direction, after?.ref ?? focused.ref);
    }
  }

  /** Refs that count as "arrived": the target itself, or its focusable descendants. */
  private async focusTargets(goal: LocatorImpl, el: ElementSnapshot): Promise<ReadonlySet<string>> {
    if (el.focusable) return new Set([el.ref]);
    const node = findNode(await this.ctx.target.tree(), el.ref);
    if (!node) return new Set([el.ref]);
    const refs = [...walkTree(node)].filter((n) => n.focusable && n.visible).map((n) => n.ref);
    if (!refs.length) {
      throw new DpadError(
        'TARGET_NOT_FOCUSABLE',
        `${goal.description} is not focusable and contains nothing focusable.`,
        {
          hint: 'Navigate to the focusable element itself (a card or button), or to a container holding one. Check focusability in app.snapshot().',
          docs: docsLink('core/focus-navigation'),
        },
      );
    }
    return new Set(refs);
  }

  private async waitForFocus(): Promise<ElementSnapshot> {
    const result = await this.ctx.retry(async () => {
      const f = await this.ctx.target.focused();
      return { ok: f !== null, value: f };
    }, this.ctx.timeouts.actionMs);
    if (result.value) return result.value;
    throw new DpadError('NO_FOCUS', 'Nothing is focused, so focus cannot be navigated.', {
      hint: 'Launch the app and wait until it is ready (e.g. expect(app.focus.current()).toBeVisible()) before navigating.',
      docs: docsLink('core/focus-navigation'),
    });
  }

  private async chooseDirection(
    from: ElementRef,
    goal: Rect,
    goals: ReadonlySet<string>,
    visits: ReadonlyMap<ElementRef, Visit>,
  ): Promise<Direction | null> {
    const here = visits.get(from) as Visit;
    const graph = await this.ctx.target.focusGraph();
    if (graph) {
      // A `null` edge is known not to move focus: never spend a press on it.
      const node = graph.find((n) => n.id === from);
      for (const d of DIRECTIONS) {
        if (node?.[d] !== null || here.tried.has(d)) continue;
        here.tried.add(d);
        here.edges.set(d, from);
      }
      const step = nextStepInGraph(graph, from, goals);
      if (step && !here.tried.has(step)) return step;
      this.ctx.log('the focus graph has no untried path from here; using geometry');
    }
    const toward = (v: Visit) => towardDirections(v.bounds, goal).filter((d) => !v.tried.has(d));
    const any = (v: Visit) => rankDirections(v.bounds, goal).filter((d) => !v.tried.has(d));
    return (
      toward(here)[0] ??
      walkToward(visits, from, (v) => toward(v).length > 0) ??
      any(here)[0] ??
      walkToward(visits, from, (v) => any(v).length > 0)
    );
  }

  /** Waits until focus leaves `from`, the app is idle, or the settle time passes. */
  private async settle(from: ElementRef): Promise<void> {
    const settleMs = this.ctx.timeouts.navigationSettleMs;
    const idle = await this.ctx.target.waitForIdle(settleMs);
    if (idle.supported && idle.idle) return;
    const deadline = performance.now() + settleMs;
    while (performance.now() < deadline) {
      const now = await this.ctx.target.focused();
      if (now?.ref !== from) return;
      await sleep(SETTLE_POLL_MS);
    }
  }

  private unreachable(
    goal: LocatorImpl,
    focused: ElementSnapshot,
    path: readonly Direction[],
    reason: string,
  ): DpadError {
    return new DpadError(
      'FOCUS_UNREACHABLE',
      `Could not move focus to ${goal.description}: ${reason}. Focus is on ${describeElement(focused)}. Path: ${path.length ? path.join(', ') : '(none)'}.`,
      {
        hint: 'The target may be disabled, hidden, behind a focus trap, or not reachable with the D-pad from here. Inspect app.snapshot(), navigate in smaller steps, or raise maxPresses for long lists.',
        docs: docsLink('core/focus-navigation'),
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
        throw new DpadError(
          'FOCUS_UNCHANGED',
          `Focus stayed on ${describeElement(before)} for ${timeoutMs}ms after the action.`,
          {
            hint: 'The action did not move focus. Check the key and the screen state; raise timeoutMs only if the app is known to react slowly.',
            docs: docsLink('core/focus-navigation'),
          },
        );
      }
    });
  }
}
