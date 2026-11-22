/**
 * Pure helpers over UI trees. Exported so drivers that fetch a whole page source per snapshot
 * (Appium) and the SDK path evaluate selectors with exactly the same semantics.
 */
import type { ProtocolNode, Viewport } from '@dpad-tv/protocol';
import type { Selector, SelectorChain } from '../selectors.js';
import type { ElementRef, ElementSnapshot, Rect, UINode, UITree } from '../snapshot.js';

/** Collapses whitespace runs to one space and trims. Empty results become `null`. */
export function normalizeText(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const out = text.replace(/\s+/g, ' ').trim();
  return out.length ? out : null;
}

/**
 * The single definition of text matching for `getByText`:
 * - `RegExp`: tested against the normalized text.
 * - `exact`: normalized text equals `value` (case-sensitive).
 * - default: normalized text contains `value`, case-insensitive.
 */
export function matchText(
  text: string | null,
  value: string | RegExp,
  exact: boolean | undefined,
): boolean {
  const normalized = normalizeText(text);
  if (normalized === null) return false;
  if (value instanceof RegExp) {
    value.lastIndex = 0;
    return value.test(normalized);
  }
  const wanted = normalizeText(value) ?? '';
  return exact ? normalized === wanted : normalized.toLowerCase().includes(wanted.toLowerCase());
}

/** Drops `children` from a tree node. */
export function toSnapshot(node: UINode): ElementSnapshot {
  const { children: _children, ...snapshot } = node;
  return snapshot;
}

/** Depth-first, document order, root first. */
export function* walkTree(root: UINode): Generator<UINode> {
  yield root;
  for (const child of root.children) yield* walkTree(child);
}

function* descendants(node: UINode): Generator<UINode> {
  for (const child of node.children) yield* walkTree(child);
}

/** Finds a node by ref. */
export function findNode(tree: UITree, ref: ElementRef): UINode | null {
  for (const node of walkTree(tree.root)) if (node.ref === ref) return node;
  return null;
}

function matchesStep(node: UINode, step: Exclude<Selector, { kind: 'nth' }>): boolean {
  switch (step.kind) {
    case 'testId':
      return node.testId === step.value;
    case 'focused':
      return node.focused;
    case 'text':
      // The deepest elements whose text matches, not every ancestor that contains it.
      return (
        matchText(node.text, step.value, step.exact) &&
        !node.children.some((c) => matchText(c.text, step.value, step.exact))
      );
  }
}

/**
 * Evaluates a selector chain over a tree. The first step searches the whole tree (root
 * included); each later step searches the descendants of the previous matches; `nth` picks one
 * match. Results are deduplicated and keep tree order per scope.
 */
export function evaluateChain(tree: UITree, chain: SelectorChain): readonly ElementSnapshot[] {
  let current: UINode[] | null = null; // null = document scope
  for (const step of chain) {
    if (step.kind === 'nth') {
      const picked: UINode | undefined = (current ?? [tree.root])[step.index];
      current = picked ? [picked] : [];
      continue;
    }
    const next: UINode[] = [];
    const seen = new Set<UINode>();
    const scopes: Iterable<UINode>[] = current
      ? current.map((scope) => descendants(scope))
      : [walkTree(tree.root)];
    for (const scope of scopes) {
      for (const node of scope) {
        if (!seen.has(node) && matchesStep(node, step)) {
          seen.add(node);
          next.push(node);
        }
      }
    }
    current = next;
  }
  return (current ?? [tree.root]).map(toSnapshot);
}

function intersects(a: Rect, viewport: { width: number; height: number }): boolean {
  return a.x < viewport.width && a.y < viewport.height && a.x + a.width > 0 && a.y + a.height > 0;
}

/**
 * Converts an SDK tree into the core tree shape: descendant text is concatenated from visible
 * nodes, `focusWithin` and `busy` propagate up and visibility requires visible ancestors.
 * `viewport` is the one reported with the tree (default: the root's size).
 */
export function protocolToTree(root: ProtocolNode, reported?: Viewport): UITree {
  const viewport = reported
    ? { width: reported.width, height: reported.height }
    : { width: root.bounds.width, height: root.bounds.height };
  const convert = (node: ProtocolNode, parentVisible: boolean): UINode => {
    const visible =
      parentVisible && node.visible && (node.bounds.width > 0 || node.bounds.height > 0);
    const children = node.children.map((c) => convert(c, visible));
    const ownText = visible ? normalizeText(node.text) : null;
    const text = normalizeText(
      [ownText, ...children.map((c) => (c.visible ? c.text : null))].filter(Boolean).join(' '),
    );
    return {
      ref: node.id as ElementRef,
      testId: node.testId ?? null,
      text,
      label: node.label ?? null,
      bounds: node.bounds,
      visible,
      inViewport: visible && intersects(node.bounds, viewport),
      focusable: node.focusable,
      focused: node.focused,
      focusWithin: node.focused || children.some((c) => c.focusWithin),
      enabled: node.enabled,
      selected: node.selected,
      busy: node.busy || children.some((c) => c.busy),
      children,
    };
  };
  return { root: convert(root, true), viewport };
}
