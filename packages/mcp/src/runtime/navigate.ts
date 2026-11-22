/**
 * Geometry-based focus navigation with real D-pad presses.
 *
 * TODO(core): replace with `app.focus.navigateTo(locator)` from the core (it also uses
 * the SDK focus graph when available). The contract kept here: real presses only, the
 * effective path is returned, and an unreachable target fails with a precise reason.
 */
import {
  DpadError,
  docsLink,
  type Direction,
  type ElementRef,
  type ElementSnapshot,
  type Rect,
} from '@dpad-tv/core';
import { describeElement } from './text-snapshot.js';

export interface NavigateDeps {
  /** Resolves the target freshly (rails scroll, so bounds change after every press). */
  resolve(): Promise<ElementSnapshot>;
  focused(): Promise<ElementSnapshot | null>;
  /** Presses a D-pad key and returns the focused element once focus settled. */
  move(direction: Direction): Promise<ElementSnapshot | null>;
}

export interface NavigateResult {
  /** Directions that moved focus, in order. Replaying them reproduces the navigation. */
  readonly path: readonly Direction[];
  /** All presses sent, including ones that did not move focus. */
  readonly presses: number;
  readonly focused: ElementSnapshot;
}

export async function navigateTo(deps: NavigateDeps, maxPresses: number): Promise<NavigateResult> {
  const path: Direction[] = [];
  let presses = 0;
  // Moves already tried from an element that did not bring focus closer.
  const dead = new Map<ElementRef, Set<Direction>>();
  const visited = new Set<ElementRef>();

  for (;;) {
    const target = await deps.resolve();
    const focus = await deps.focused();
    if (!focus) {
      throw new DpadError('MCP_NO_FOCUS', 'No element has focus, so there is nothing to move.', {
        hint: 'Some TV apps only show focus after the first key press. Press a D-pad key once, then retry.',
        docs: docsLink('concepts/focus'),
      });
    }
    if (target.focused || target.focusWithin) return { path, presses, focused: focus };
    visited.add(focus.ref);

    const tried = dead.get(focus.ref) ?? new Set<Direction>();
    dead.set(focus.ref, tried);
    const direction = rankDirections(focus.bounds, target.bounds).find((d) => !tried.has(d));
    if (!direction || presses >= maxPresses) {
      throw new DpadError(
        'MCP_UNREACHABLE',
        `Could not move focus to ${describeElement(target)} (${presses} presses, path: ${
          path.join(' ') || 'none'
        }). Focus is stuck on ${describeElement(focus)}.`,
        {
          hint: !direction
            ? 'Every direction toward the target is blocked from the focused element. The target may be disabled, not focusable, or behind a focus trap (modal, side menu). Check `snapshot`, or press other keys to leave the current area first.'
            : 'The press budget ran out. Raise `maxPresses` for long lists, or navigate in steps.',
          docs: docsLink('concepts/focus'),
        },
      );
    }

    presses++;
    const next = await deps.move(direction);
    if (!next || next.ref === focus.ref || visited.has(next.ref)) {
      tried.add(direction);
      if (next && next.ref !== focus.ref) path.push(direction);
      continue;
    }
    path.push(direction);
  }
}

/** Directions that bring focus closer to `to`, largest gap first, then neutral ones. */
export function rankDirections(from: Rect, to: Rect): Direction[] {
  const dx = gap(from.x, from.width, to.x, to.width);
  const dy = gap(from.y, from.height, to.y, to.height);
  const toward: [Direction, number][] = [];
  if (dx !== 0) toward.push([dx > 0 ? 'right' : 'left', Math.abs(dx)]);
  if (dy !== 0) toward.push([dy > 0 ? 'down' : 'up', Math.abs(dy)]);
  toward.sort((a, b) => b[1] - a[1]);
  const ranked = toward.map(([d]) => d);
  if (dx === 0) ranked.push('right', 'left');
  if (dy === 0) ranked.push('down', 'up');
  return ranked;
}

/** Signed distance between two 1-D ranges; 0 when they overlap. */
function gap(aStart: number, aSize: number, bStart: number, bSize: number): number {
  if (bStart >= aStart + aSize) return bStart - (aStart + aSize) + 1;
  if (bStart + bSize <= aStart) return bStart + bSize - aStart - 1;
  return 0;
}
