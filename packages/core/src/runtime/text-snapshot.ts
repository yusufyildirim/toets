/**
 * Text screen snapshots: a YAML outline of what is on screen, designed to be deterministic,
 * cheap for LLMs to read and comparable across platforms.
 *
 * Format, one entry per meaningful element, in tree order:
 *
 * ```yaml
 * - side_menu:
 *   - menu_home "Home" [focused]
 *   - menu_settings "Settings"
 * - rail_trending:
 *   - card_1 "Big Buck Bunny" [selected]
 *   - text "Loading" [busy]
 * ```
 *
 * - Name: the test ID; `text` for an anonymous text element; `element` for an anonymous
 *   focusable or busy element.
 * - Text: shown on the element that owns it (no child carries text), whitespace-normalized.
 * - States, in fixed order: `focused`, `selected`, `busy`, `disabled`, `offscreen`.
 * - Only visible elements inside the viewport are listed (plus the focused one); wrappers
 *   without a test ID, text or state are skipped and their children hoisted, so platform
 *   layout differences do not leak into the snapshot. Bounds are never included.
 */
import type { UINode, UITree } from '../snapshot.js';

interface Entry {
  readonly line: string;
  readonly children: readonly Entry[];
}

const hasOwnText = (node: UINode): boolean =>
  node.text !== null && !node.children.some((c) => c.visible && c.text !== null);

const ownBusy = (node: UINode): boolean => node.busy && !node.children.some((c) => c.busy);

function isShown(node: UINode): boolean {
  return node.focused || (node.visible && node.inViewport);
}

function isMeaningful(node: UINode): boolean {
  return (
    node.testId !== null ||
    node.focused ||
    node.focusable ||
    node.selected ||
    ownBusy(node) ||
    hasOwnText(node)
  );
}

function states(node: UINode): string[] {
  const out: string[] = [];
  if (node.focused) out.push('focused');
  if (node.selected) out.push('selected');
  if (ownBusy(node)) out.push('busy');
  if (!node.enabled) out.push('disabled');
  if (!node.inViewport) out.push('offscreen');
  return out;
}

function lineOf(node: UINode): string {
  const ownText = hasOwnText(node) ? node.text : null;
  const name = node.testId ?? (ownText !== null ? 'text' : 'element');
  let line = name;
  if (ownText !== null) line += ` ${JSON.stringify(ownText)}`;
  const s = states(node);
  if (s.length) line += ` [${s.join(', ')}]`;
  return line;
}

function collect(node: UINode, force: boolean): Entry[] {
  // A hidden element hides its subtree; a shown-but-offscreen parent may still hold the focus.
  if (!force && !node.visible && !node.focusWithin) return [];
  const children = node.children.flatMap((c) => collect(c, false));
  if (force || (isShown(node) && isMeaningful(node))) return [{ line: lineOf(node), children }];
  return children;
}

const PLAIN_UNSAFE_START = /^[-?:,[\]{}#&*!|>'"%@`\s]/;

/** Emits `value` as a YAML plain scalar when safe, otherwise single-quoted. */
function yamlScalar(value: string): string {
  const plain =
    !PLAIN_UNSAFE_START.test(value) &&
    !value.includes(': ') &&
    !value.includes(' #') &&
    !value.endsWith(':') &&
    !value.endsWith(' ');
  return plain ? value : `'${value.replace(/'/g, "''")}'`;
}

function render(entries: readonly Entry[], indent: string, out: string[]): void {
  for (const entry of entries) {
    const scalar = yamlScalar(entry.line);
    if (entry.children.length) {
      out.push(`${indent}- ${scalar}:`);
      render(entry.children, `${indent}  `, out);
    } else {
      out.push(`${indent}- ${scalar}`);
    }
  }
}

/**
 * Renders a tree (or the subtree at `root`) as a text snapshot. A given `root` is always listed,
 * even when it would otherwise be skipped.
 */
export function renderTextSnapshot(tree: UITree, root?: UINode): string {
  const entries = root ? collect(root, true) : collect(tree.root, false);
  if (!entries.length) return '[]';
  const out: string[] = [];
  render(entries, '', out);
  return out.join('\n');
}

/** Normalizes a snapshot for comparison: dedent, drop trailing spaces and blank edges. */
export function normalizeTextSnapshot(snapshot: string): string {
  const lines = snapshot
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''));
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  const indents = lines.filter((l) => l.length).map((l) => l.length - l.trimStart().length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join('\n');
}
