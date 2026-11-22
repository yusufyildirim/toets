import type { ElementRef, ElementSnapshot, SelectorChain, UINode, UITree } from '@dpad-tv/core';

/**
 * Resolves a selector chain against one tree fetch. Semantics match the core's reference
 * (`FakeDriver`): the first step searches the whole tree (root included), later steps search
 * descendants of the previous matches, `text` matches the deepest elements whose text matches,
 * `nth` picks one match. Results are in tree order without duplicates.
 */
export function queryTree(tree: UITree, chain: SelectorChain): ElementSnapshot[] {
  let current: (UINode | null)[] = [null];
  for (const step of chain) {
    if (step.kind === 'nth') {
      const picked = current[step.index];
      current = picked ? [picked] : [];
      continue;
    }
    const next: UINode[] = [];
    for (const scope of current) {
      const candidates = scope ? descendants(scope) : [tree.root, ...descendants(tree.root)];
      for (const n of candidates) {
        if (matches(n, step) && !next.includes(n)) next.push(n);
      }
    }
    current = next;
  }
  return current.filter((n): n is UINode => n !== null).map(toSnapshot);
}

/** The focused element of a tree, or `null`. */
export function focusedIn(tree: UITree): ElementSnapshot | null {
  const n = [tree.root, ...descendants(tree.root)].find((d) => d.focused);
  return n ? toSnapshot(n) : null;
}

/** The node with this ref, or `null` when it is no longer in the tree. */
export function findByRef(tree: UITree, ref: ElementRef): UINode | null {
  return [tree.root, ...descendants(tree.root)].find((d) => d.ref === ref) ?? null;
}

/** Strips `children` so snapshots stay small and match the {@link ElementSnapshot} shape. */
export function toSnapshot(n: UINode): ElementSnapshot {
  const { children: _children, ...snapshot } = n;
  return snapshot;
}

function descendants(n: UINode): UINode[] {
  const out: UINode[] = [];
  const walk = (node: UINode) => {
    for (const c of node.children) {
      out.push(c);
      walk(c);
    }
  };
  walk(n);
  return out;
}

function matches(n: UINode, step: SelectorChain[number]): boolean {
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
    default:
      return false;
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
