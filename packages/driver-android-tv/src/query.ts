import type { ElementSnapshot, Selector, SelectorChain, UINode } from '@dpad-tv/core';

/**
 * Resolves a selector chain against a snapshot tree. Semantics match every other dpad driver
 * (and `FakeDriver`): the first step searches the whole tree (root included), later steps
 * search descendants of the previous matches; `text` matches the deepest elements whose
 * aggregated text matches; `nth` picks from the previous step's matches.
 *
 * Platform neutral on purpose: it only reads {@link UINode} fields.
 */
export function queryTree(root: UINode, chain: SelectorChain): ElementSnapshot[] {
  let current: (UINode | null)[] = [null];
  for (const step of chain) {
    if (step.kind === 'nth') {
      const picked = current[step.index];
      current = picked ? [picked] : [];
      continue;
    }
    const next: UINode[] = [];
    const seen = new Set<UINode>();
    for (const scope of current) {
      const candidates = scope ? descendants(scope) : [root, ...descendants(root)];
      for (const n of candidates) {
        if (!seen.has(n) && matches(n, step)) {
          seen.add(n);
          next.push(n);
        }
      }
    }
    current = next;
  }
  return current.filter((n): n is UINode => n !== null).map(toSnapshot);
}

/** The focused element (first in document order), or `null`. */
export function findFocused(root: UINode): ElementSnapshot | null {
  for (const n of [root, ...descendants(root)]) {
    if (n.focused) return toSnapshot(n);
  }
  return null;
}

/** All descendants in depth-first pre-order (document order). */
export function descendants(node: UINode): UINode[] {
  const out: UINode[] = [];
  const walk = (n: UINode) => {
    for (const c of n.children) {
      out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

/** Strips `children` so results are plain snapshots. */
export function toSnapshot(node: UINode): ElementSnapshot {
  const { children: _children, ...snapshot } = node;
  return snapshot;
}

function matches(n: UINode, step: Exclude<Selector, { kind: 'nth' }>): boolean {
  switch (step.kind) {
    case 'testId':
      return n.testId === step.value;
    case 'focused':
      return n.focused;
    case 'text':
      return (
        textMatches(n.text, step.value, step.exact) &&
        !n.children.some((c) => textMatches(c.text, step.value, step.exact))
      );
  }
}

function textMatches(text: string | null, value: string | RegExp, exact?: boolean): boolean {
  if (text === null) return false;
  if (value instanceof RegExp) {
    value.lastIndex = 0;
    return value.test(text);
  }
  return exact ? text === value : text.toLowerCase().includes(value.toLowerCase());
}
