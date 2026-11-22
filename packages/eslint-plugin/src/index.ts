/**
 * `@dpad-tv/eslint-plugin`: rules that keep dpad tests deterministic, cross-platform and
 * readable. Flat config only.
 *
 * @example
 * ```js
 * // eslint.config.js
 * import dpad from '@dpad-tv/eslint-plugin';
 *
 * export default [{ files: ['e2e/**'], ...dpad.configs.recommended }];
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

const rules = {
  'no-sleep': noSleep,
  'page-object-assertions': pageObjectAssertions,
  'no-platform-only': noPlatformOnly,
  'prefer-semantic-keys': preferSemanticKeys,
} satisfies Record<string, Rule.RuleModule>;

/** Names of the rules in this plugin. */
export type RuleName = keyof typeof rules;

/** The dpad ESLint plugin: `rules` plus flat `configs`. */
export interface DpadEslintPlugin extends ESLint.Plugin {
  readonly meta: { readonly name: string; readonly namespace: string };
  readonly rules: Readonly<Record<RuleName, Rule.RuleModule>>;
  readonly configs: {
    /**
     * Every rule at its recommended level, registered under the `@dpad-tv` namespace.
     * Carries no `files`: spread it into a config object scoped to your E2E folder.
     */
    readonly recommended: Linter.Config;
  };
}

const recommendedRules: Linter.RulesRecord = {
  '@dpad-tv/no-sleep': 'error',
  '@dpad-tv/page-object-assertions': 'error',
  '@dpad-tv/no-platform-only': 'warn',
  '@dpad-tv/prefer-semantic-keys': 'error',
};

const configs = {} as { recommended: Linter.Config };

const plugin: DpadEslintPlugin = {
  meta: { name: '@dpad-tv/eslint-plugin', namespace: '@dpad-tv' },
  rules,
  configs,
};

// The config references the plugin object itself, so it is attached after creation.
configs.recommended = {
  name: '@dpad-tv/recommended',
  plugins: { '@dpad-tv': plugin },
  rules: recommendedRules,
};

export default plugin;
