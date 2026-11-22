import type { Node } from 'estree';

/**
 * Shipped docs page of a rule. Uses the same slug convention as `docsLink` in `@dpad-tv/core`
 * (`node_modules/@dpad-tv/<pkg>/docs/<slug>.md`) until the docs site domain is decided.
 */
export function ruleDocsUrl(rule: string): string {
  return `node_modules/@dpad-tv/eslint-plugin/docs/rules/${rule}.md`;
}

const TS_WRAPPERS = new Set([
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'TSTypeAssertion',
  'ChainExpression',
]);

/**
 * Strips type-only wrappers (`x as Key`, `x!`, `<Key>x`, `x satisfies Key`) and optional chains
 * so rules see the runtime expression. Works with any parser: TS nodes are matched by type name.
 */
export function unwrap(node: Node): Node {
  let current = node as Node & { expression?: Node };
  while (TS_WRAPPERS.has(current.type as string) && current.expression) {
    current = current.expression as Node & { expression?: Node };
  }
  return current;
}

/** Name of an identifier, or the static property name of a member expression (`a.b`, `a['b']`). */
export function staticName(node: Node): string | null {
  const n = unwrap(node);
  if (n.type === 'Identifier') return n.name;
  if (n.type === 'MemberExpression') {
    if (!n.computed && n.property.type === 'Identifier') return n.property.name;
    if (n.computed && n.property.type === 'Literal' && typeof n.property.value === 'string') {
      return n.property.value;
    }
  }
  return null;
}
