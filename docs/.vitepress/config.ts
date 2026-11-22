import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { defineConfig } from 'vitepress';
import { generateLlms } from './llms.ts';
import { nav, sidebar } from './sidebar.ts';

const title = 'dpad';
const description =
  'Cross-platform E2E testing for TV apps: one test for web, Android TV / Fire TV and tvOS, with focus and the remote as first-class primitives.';

// Pages outside docs/ (package docs, skills) import Vue from their own folders, where it is not
// installed. Resolve it from the docs package for every page.
const vueDir = dirname(createRequire(import.meta.url).resolve('vue/package.json'));

export default defineConfig({
  title,
  description,
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: false,
  // The site renders docs/, every package's docs/ and the agent skills, without copying them.
  srcDir: '..',
  srcExclude: [
    '*.md',
    '.changeset/**',
    'examples/**',
    'packages/*/*.md',
    'packages/*/src/**',
    'packages/*/test/**',
    'packages/*/fixtures/**',
    'docs/README.md',
    'docs/templates/**',
    '**/CHANGELOG.md',
  ],
  rewrites: {
    'docs/:path(.*)': ':path',
    'packages/:pkg/docs/:page(.*)': 'reference/:pkg/docs/:page',
    'skills/:name/SKILL.md': 'skills/:name.md',
  },
  vite: {
    resolve: { alias: [{ find: /^vue(?=$|\/)/, replacement: vueDir }] },
  },
  themeConfig: {
    nav,
    sidebar: sidebar(),
    outline: { level: [2, 3] },
    search: { provider: 'local' },
  },
  transformPageData(page) {
    // Package overview pages are generated from one dynamic route; title them per package.
    if (typeof page.params?.name === 'string') page.title = page.params.name;
  },
  buildEnd(config) {
    generateLlms(config, {
      title,
      summary: description,
      intro: `
Pre-alpha: APIs may change. dpad runs on Playwright Test; platforms are Playwright projects and tests receive one \`app\` fixture.

Rules that differ from web and mobile testing:
- There is no click. Move focus with the remote (\`app.focus.navigateTo\`, \`app.remote.press\`), then press \`Key.SELECT\`.
- Assert focus after navigating: \`await expect(locator).toBeFocused()\`.
- Assertions retry until timeout. Never sleep.
- Platform gaps are capabilities: declare \`requires\` instead of branching on the platform.
- Negative assertions need a positive anchor first (or the SDK idle signal).

Errors print \`DpadError: [CODE] message\` with a \`Hint:\` and a \`Docs:\` page; every code is listed in [Error codes](/reference/core/docs/errors.md). Installed packages ship their reference pages offline in \`node_modules/@dpad-tv/*/docs/\`.
`,
    });
  },
});
