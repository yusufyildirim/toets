import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';
import plugin from '../src/index.js';

describe('plugin', () => {
  it('ships docs metadata for every rule', () => {
    for (const [name, rule] of Object.entries(plugin.rules)) {
      expect(rule.meta?.docs?.url).toBe(`reference/eslint-plugin/docs/rules/${name}`);
      expect(rule.meta?.docs?.description).toBeTruthy();
    }
  });

  it('recommended config lints a flat-config project end to end', async () => {
    const eslint = new ESLint({
      cwd: '/project',
      overrideConfigFile: true,
      overrideConfig: [
        {
          files: ['e2e/**/*.ts'],
          languageOptions: { parser: tseslint.parser },
          ...plugin.configs.recommended,
        },
      ],
    });
    const code = [
      'await sleep(100);',
      'await app.platformOnly("web", async () => {});',
      'await app.remote.press("UP");',
      'await expect(title).toHaveText("Home");',
    ].join('\n');
    const [result] = await eslint.lintText(code, { filePath: '/project/e2e/pages/home.ts' });
    expect(result?.messages.map((m) => [m.ruleId, m.severity])).toEqual([
      ['@dpad-tv/no-sleep', 2],
      ['@dpad-tv/no-platform-only', 1],
      ['@dpad-tv/prefer-semantic-keys', 2],
      ['@dpad-tv/page-object-assertions', 2],
    ]);
  });
});
