/**
 * `@toets/eslint-plugin`: rules that keep toets tests deterministic, cross-platform and
 * readable. Flat config only.
 *
 * @example
 * ```js
 * // eslint.config.js
 * import toets from '@toets/eslint-plugin';
 *
 * export default [{ files: ['e2e/**'], ...toets.configs.recommended }];
 * ```
 */
import type { ESLint, Linter, Rule } from 'eslint';
import { noPlatformOnly } from './rules/no-platform-only.js';
import { noSleep } from './rules/no-sleep.js';
import { pageObjectAssertions } from './rules/page-object-assertions.js';
import { preferSemanticKeys } from './rules/prefer-semantic-keys.js';

export { DEFAULT_SLEEP_FUNCTIONS, type NoSleepOptions } from './rules/no-sleep.js';
export {
  DEFAULT_PAGE_OBJECT_FILES,
  DEFAULT_STABILITY_MATCHERS,
  type PageObjectAssertionsOptions,
} from './rules/page-object-assertions.js';

/** Names of the rules in this plugin. */
export type RuleName =
  'no-sleep' | 'page-object-assertions' | 'no-platform-only' | 'prefer-semantic-keys';

const rules: Record<RuleName, Rule.RuleModule> = {
  'no-sleep': noSleep,
  'page-object-assertions': pageObjectAssertions,
  'no-platform-only': noPlatformOnly,
  'prefer-semantic-keys': preferSemanticKeys,
};

/** The toets ESLint plugin: `rules` plus flat `configs`. */
export interface ToetsEslintPlugin extends ESLint.Plugin {
  readonly meta: { readonly name: string; readonly namespace: string };
  readonly rules: Readonly<Record<RuleName, Rule.RuleModule>>;
  readonly configs: {
    /**
     * Every rule at its recommended level, registered under the `@toets` namespace.
     * Carries no `files`: spread it into a config object scoped to your E2E folder.
     */
    readonly recommended: Linter.Config;
  };
}

const recommendedRules: Linter.RulesRecord = {
  '@toets/no-sleep': 'error',
  '@toets/page-object-assertions': 'error',
  '@toets/no-platform-only': 'warn',
  '@toets/prefer-semantic-keys': 'error',
};

const configs = {} as { recommended: Linter.Config };

const plugin: ToetsEslintPlugin = {
  meta: { name: '@toets/eslint-plugin', namespace: '@toets' },
  rules,
  configs,
};

// The config references the plugin object itself, so it is attached after creation.
configs.recommended = {
  name: '@toets/recommended',
  plugins: { '@toets': plugin },
  rules: recommendedRules,
};

export default plugin;
