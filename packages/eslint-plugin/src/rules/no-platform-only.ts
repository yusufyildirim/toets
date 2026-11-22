import type { Rule } from 'eslint';
import { ruleDocsUrl, staticName, unwrap } from '../utils.js';

export const noPlatformOnly: Rule.RuleModule = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Discourage `app.platformOnly`, the escape hatch to the underlying tool.',
      recommended: true,
      url: ruleDocsUrl('no-platform-only'),
    },
    schema: [],
    messages: {
      platformOnly:
        '`platformOnly` runs code on one platform only, so this test no longer means the same thing everywhere. Prefer a core API or `requires` a capability; if truly needed, isolate it in a fixture and explain why.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = unwrap(node.callee);
        if (callee.type === 'MemberExpression' && staticName(callee) === 'platformOnly') {
          context.report({ node: callee.property, messageId: 'platformOnly' });
        }
      },
    };
  },
};
