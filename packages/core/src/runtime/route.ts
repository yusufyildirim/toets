/**
 * Route planning over element geometry: a model of how TV focus engines pick the next element
 * for a direction, used to press a whole walk at once (keyboard keys) instead of reading focus
 * after every press. The model is a prediction; callers verify where focus landed and fall back
 * to step-by-step navigation when it was wrong.
 */
import type { Direction } from '../keys.js';
import type { Rect } from '../snapshot.js';

export interface RouteNode {
  readonly id: string;
  readonly bounds: Rect;
}

const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];

const horizontal = (d: Direction) => d === 'left' || d === 'right';

/** Whether `to` lies in `direction` from `from` (Android `FocusFinder.isCandidate`). */
function isCandidate(from: Rect, to: Rect, direction: Direction): boolean {
  switch (direction) {
    case 'right':
      return (
        (from.x < to.x || from.x + from.width <= to.x) && from.x + from.width < to.x + to.width
      );
    case 'left':
      return (from.x + from.width > to.x + to.width || from.x >= to.x + to.width) && from.x > to.x;
    case 'down':
      return (
        (from.y < to.y || from.y + from.height <= to.y) && from.y + from.height < to.y + to.height
      );
    case 'up':
      return (
        (from.y + from.height > to.y + to.height || from.y >= to.y + to.height) && from.y > to.y
      );
  }
}

/** Overlap on the axis across `direction`: the candidate is in the beam of the source. */
function inBeam(from: Rect, to: Rect, direction: Direction): boolean {
  return horizontal(direction)
    ? to.y < from.y + from.height && from.y < to.y + to.height
    : to.x < from.x + from.width && from.x < to.x + to.width;
}

/** Edge gap along `direction` and center offset across it. */
function distances(from: Rect, to: Rect, direction: Direction): [major: number, minor: number] {
  switch (direction) {
    case 'right':
      return [
        Math.max(0, to.x - (from.x + from.width)),
        Math.abs(to.y + to.height / 2 - (from.y + from.height / 2)),
      ];
    case 'left':
      return [
        Math.max(0, from.x - (to.x + to.width)),
        Math.abs(to.y + to.height / 2 - (from.y + from.height / 2)),
      ];
    case 'down':
      return [
        Math.max(0, to.y - (from.y + from.height)),
        Math.abs(to.x + to.width / 2 - (from.x + from.width / 2)),
      ];
    case 'up':
      return [
        Math.max(0, from.y - (to.y + to.height)),
        Math.abs(to.x + to.width / 2 - (from.x + from.width / 2)),
      ];
  }
}

/**
 * The element a focus engine most likely moves to from `from` in `direction`: candidates in
 * the beam win over others, then the lowest `13 * major² + minor²` (Android's weighting).
 * `null` when nothing lies that way.
 */
export function nextInDirection(
  from: RouteNode,
  direction: Direction,
  nodes: readonly RouteNode[],
): RouteNode | null {
  let best: RouteNode | null = null;
  let bestScore: [number, number] = [Infinity, Infinity];
  for (const node of nodes) {
    if (node.id === from.id || !isCandidate(from.bounds, node.bounds, direction)) continue;
    const [major, minor] = distances(from.bounds, node.bounds, direction);
    const score: [number, number] = [
      inBeam(from.bounds, node.bounds, direction) ? 0 : 1,
      13 * major * major + minor * minor,
    ];
    if (score[0] < bestScore[0] || (score[0] === bestScore[0] && score[1] < bestScore[1])) {
      best = node;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Shortest walk of directions from `fromId` to `toId` over the predicted moves between `nodes`,
 * or `null` when the model finds none within `maxLength` presses.
 */
export function planRoute(
  nodes: readonly RouteNode[],
  fromId: string,
  toId: string,
  maxLength = 40,
): Direction[] | null {
  if (fromId === toId) return [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  if (!byId.has(fromId) || !byId.has(toId)) return null;
  const previous = new Map<string, { readonly from: string; readonly direction: Direction }>();
  let frontier = [fromId];
  const seen = new Set(frontier);
  for (let depth = 0; depth < maxLength && frontier.length; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      const node = byId.get(id) as RouteNode;
      for (const direction of DIRECTIONS) {
        const to = nextInDirection(node, direction, nodes);
        if (!to || seen.has(to.id)) continue;
        seen.add(to.id);
        previous.set(to.id, { from: id, direction });
        if (to.id === toId) {
          const route: Direction[] = [];
          for (let at = toId; at !== fromId;) {
            const step = previous.get(at) as { from: string; direction: Direction };
            route.unshift(step.direction);
            at = step.from;
          }
          return route;
        }
        next.push(to.id);
      }
    }
    frontier = next;
  }
  return null;
}
