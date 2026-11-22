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

/** First step of a shortest path through the SDK focus graph, or `null`. */
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

  private async navigate(goal: LocatorImpl, maxPresses: number): Promise<readonly Direction[]> {
    const path: Direction[] = [];
    const tried = new Map<ElementRef, Set<Direction>>();
    let goals: ReadonlySet<string> | null = null;

    for (;;) {
      const el = await goal.resolveOne();
      if (el.focused || el.focusWithin) return path;
      goals ??= await this.focusTargets(goal, el);

      const focused = await this.waitForFocus();
      if (path.length >= maxPresses) {
        throw this.unreachable(goal, focused, path, `gave up after ${maxPresses} presses`);
      }
      const triedHere = tried.get(focused.ref) ?? new Set<Direction>();
      tried.set(focused.ref, triedHere);
      const direction = await this.chooseDirection(focused, el, goals, triedHere);
      if (!direction) {
        throw this.unreachable(goal, focused, path, 'every direction from here was tried');
      }
      triedHere.add(direction);
      await this.remote.press(DIRECTION_KEY[direction]);
      path.push(direction);
      await this.settle(focused.ref);
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
    focused: ElementSnapshot,
    goal: ElementSnapshot,
    goals: ReadonlySet<string>,
    tried: ReadonlySet<Direction>,
  ): Promise<Direction | null> {
    const graph = await this.ctx.target.focusGraph();
    if (graph) {
      const step = nextStepInGraph(graph, focused.ref, goals);
      if (step && !tried.has(step)) return step;
      this.ctx.log(
        `focus graph has no untried path from ${describeElement(focused)}; using geometry`,
      );
    }
    return rankDirections(focused.bounds, goal.bounds).find((d) => !tried.has(d)) ?? null;
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
