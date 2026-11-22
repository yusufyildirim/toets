/**
 * Minimal text snapshot (YAML, focus-aware).
 *
 * TODO(core): replace with the core text snapshot from `@dpad-tv/core`, so agents
 * see exactly the format tests assert with. Keep this module's exports as thin wrappers until then.
 *
 * Format: one YAML list item per meaningful element. Anonymous wrappers are collapsed, hidden
 * elements are dropped, and bounds are left out so snapshots compare across platforms.
 *
 * ```yaml
 * - view [testId=home_rail, focus-within]:
 *   - focusable [testId=card_a, focused]: "Alpha"
 *   - focusable [testId=card_b]: "Beta"
 * - text: "Welcome back"
 * ```
 */
import type { ElementSnapshot, UINode } from '@dpad-tv/core';

/** One-line description of an element in the snapshot vocabulary. */
export function describeElement(el: ElementSnapshot): string {
  const text = el.text ?? el.label;
  const head = header(el);
  return text ? `${head}: ${JSON.stringify(text)}` : head;
}

/** Renders `root` (included) as a YAML text snapshot. */
export function renderTextSnapshot(root: UINode): string {
  const lines: string[] = [];
  for (const item of collect(root)) render(item, 0, lines);
  return lines.length ? lines.join('\n') : '# nothing visible';
}

/** Finds the node with `ref` in a tree. */
export function findNode(root: UINode, ref: ElementSnapshot['ref']): UINode | null {
  if (root.ref === ref) return root;
  for (const child of root.children) {
    const hit = findNode(child, ref);
    if (hit) return hit;
  }
  return null;
}

interface Item {
  readonly node: UINode;
  readonly children: readonly Item[];
}

function isSignificant(node: UINode): boolean {
  return node.testId !== null || node.focusable;
}

/**
 * Significant elements of `node`'s subtree. Anonymous wrappers are hoisted away; a subtree
 * without significant elements becomes one leaf carrying its whole text.
 */
function collect(node: UINode): Item[] {
  if (!node.visible) return [];
  const nested = node.children.some(hasSignificant);
  if (isSignificant(node))
    return [{ node, children: nested ? node.children.flatMap(collect) : [] }];
  if (nested) return node.children.flatMap(collect);
  return node.text || node.label ? [{ node, children: [] }] : [];
}

function hasSignificant(node: UINode): boolean {
  return node.visible && (isSignificant(node) || node.children.some(hasSignificant));
}

function render(item: Item, depth: number, lines: string[]): void {
  const indent = '  '.repeat(depth);
  const { node, children } = item;
  if (!children.length) {
    lines.push(`${indent}- ${describeElement(node)}`);
    return;
  }
  lines.push(`${indent}- ${header(node)}:`);
  for (const child of children) render(child, depth + 1, lines);
}

function header(el: ElementSnapshot): string {
  const kind = el.focusable ? 'focusable' : el.testId !== null ? 'view' : 'text';
  const attrs: string[] = [];
  if (el.testId !== null) attrs.push(`testId=${formatId(el.testId)}`);
  if (el.focused) attrs.push('focused');
  else if (el.focusWithin) attrs.push('focus-within');
  if (el.selected) attrs.push('selected');
  if (!el.enabled) attrs.push('disabled');
  if (el.busy) attrs.push('busy');
  if (el.visible && !el.inViewport) attrs.push('offscreen');
  return attrs.length ? `${kind} [${attrs.join(', ')}]` : kind;
}

function formatId(id: string): string {
  return /^[\w.:/-]+$/.test(id) ? id : JSON.stringify(id);
}
