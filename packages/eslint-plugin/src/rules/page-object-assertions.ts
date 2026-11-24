import { matchesGlob, relative, sep } from 'node:path';
import type { Rule } from 'eslint';
import type { CallExpression, Node } from 'estree';
import { ruleDocsUrl, staticName, unwrap } from '../utils.js';

/** Options of `@toets/page-object-assertions`. */
export interface PageObjectAssertionsOptions {
  /**
   * Globs (relative to the ESLint working directory) identifying page object files.
   * Default: {@link DEFAULT_PAGE_OBJECT_FILES}.
   */
  readonly files?: readonly string[];
  /** Matchers page objects may use. Default: {@link DEFAULT_STABILITY_MATCHERS}. */
  readonly allowedMatchers?: readonly string[];
}

/** Common page object locations. Scope the plugin to your E2E folder so app code never matches. */
export const DEFAULT_PAGE_OBJECT_FILES: readonly string[] = [
  '**/pages/**',
  '**/page-objects/**',
  '**/pageObjects/**',
  '**/*.page.*',
  '**/*-page.*',
  '**/*Page.*',
];

/**
 * Stability matchers: they wait for the screen to be ready to interact with, they do not
 * verify behavior. `.not` is allowed on all of them.
 */
export const DEFAULT_STABILITY_MATCHERS: readonly string[] = [
  'toBeVisible',
  'toBeInViewport',
  'toBeFocused',
  'toHaveFocusWithin',
  'toBeBusy',
];

const MODIFIERS = new Set(['not', 'resolves', 'rejects']);

export const pageObjectAssertions: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Allow only stability matchers (visible, focused, busy) inside page objects.',
      recommended: true,
      url: ruleDocsUrl('page-object-assertions'),
    },
    schema: [
      {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          allowedMatchers: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      notAllowed:
        '`{{matcher}}` verifies behavior and belongs in the test, not the page object. Page objects may only wait for stability ({{allowed}}). Return a locator or value and assert in the test.',
    },
  },
  create(context) {
    const options = (context.options[0] ?? {}) as PageObjectAssertionsOptions;
    const patterns = options.files ?? DEFAULT_PAGE_OBJECT_FILES;
    const allowed = new Set(options.allowedMatchers ?? DEFAULT_STABILITY_MATCHERS);

    const file = relative(context.cwd, context.filename).split(sep).join('/');
    if (!patterns.some((p) => matchesGlob(file, p))) return {};

    return {
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (callee.type !== 'MemberExpression') return;
        const matcher = staticName(callee);
        if (!matcher || MODIFIERS.has(matcher) || allowed.has(matcher)) return;
        if (!isExpectCall(callee.object as Node)) return;
        context.report({
          node: callee.property,
          messageId: 'notAllowed',
          data: { matcher, allowed: [...allowed].map((m) => `\`${m}\``).join(', ') },
        });
      },
    };
  },
};

/** `expect(x)`, `expect.soft(x)`, `expect.poll(fn)`, optionally followed by `.not` etc. */
function isExpectCall(node: Node): boolean {
  let current = unwrap(node);
  while (current.type === 'MemberExpression' && MODIFIERS.has(staticName(current) ?? '')) {
    current = unwrap(current.object as Node);
  }
  if (current.type !== 'CallExpression') return false;
  const callee = unwrap((current as CallExpression).callee as Node);
  if (callee.type === 'Identifier') return callee.name === 'expect';
  return callee.type === 'MemberExpression' && staticName(callee.object as Node) === 'expect';
}
