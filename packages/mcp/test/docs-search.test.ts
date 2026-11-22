import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DocsIndex,
  excerpt,
  findDocsSources,
  splitSections,
  tokenize,
} from '../src/docs/search.js';
import { connect } from './helpers.js';

/** A fake project with two installed dpad packages that ship docs. */
async function project(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dpad-docs-')));
  const write = async (rel: string, content: string): Promise<void> => {
    await mkdir(join(root, rel, '..'), { recursive: true });
    await writeFile(join(root, rel), content);
  };
  await write(
    'node_modules/@dpad-tv/test/docs/concepts/focus.md',
    [
      '# Focus',
      'Focus is the primitive of TV apps.',
      '## navigateTo',
      'Moves focus to a locator with real D-pad presses and reports the path.',
      '```ts',
      '# not a heading inside a fence',
      'await app.focus.navigateTo(app.getByTestId("play"));',
      '```',
      '## Matchers',
      'Use toBeFocused and toHaveFocusWithin.',
    ].join('\n'),
  );
  await write(
    'node_modules/@dpad-tv/test/docs/concepts/keys.md',
    '# Keys\nSemantic keys: PLAY_PAUSE toggles, long press needs key.longpress.',
  );
  await write('node_modules/@dpad-tv/mock/docs/index.md', '# Mocking\nMSW handlers on the host.');
  await write('node_modules/@dpad-tv/nodocs/package.json', '{}');
  await mkdir(join(root, 'app'), { recursive: true });
  return root;
}

describe('docs search', () => {
  it('tokenizes identifiers and folds plurals', () => {
    expect(tokenize('navigateTo the Keys of PLAY_PAUSE capabilities')).toEqual([
      'navigateto',
      'navigate',
      'key',
      'play_pause',
      'play',
      'pause',
      'capability',
    ]);
    expect(tokenize('focus status')).toEqual(['focus', 'status']);
  });

  it('splits pages at headings, ignoring headings inside code fences', () => {
    const md = '# Focus\nintro\n## navigateTo\n```\n# comment\n```\n## Matchers\nx';
    const sections = splitSections(md, '@dpad-tv/test', 'focus.md', '/x/focus.md');
    expect(sections.map((s) => s.heading)).toEqual(['Focus', 'navigateTo', 'Matchers']);
    expect(sections[1]?.text).toContain('# comment');
    expect(sections.every((s) => s.pageTitle === 'Focus')).toBe(true);
  });

  it('finds docs of installed @dpad-tv packages from nested folders', async () => {
    const root = await project();
    const names = findDocsSources([join(root, 'app')]).map((s) => s.packageName);
    expect(names).toEqual(expect.arrayContaining(['@dpad-tv/mock', '@dpad-tv/test']));
    expect(names).not.toContain('@dpad-tv/nodocs');
  });

  it('ranks the most relevant section first', async () => {
    const root = await project();
    const index = await DocsIndex.build(findDocsSources([root]));
    // Only the fake project's pages: the real workspace packages are found too.
    const search = (q: string) => index.search(q).filter((hit) => hit.path.startsWith(root));
    expect(search('navigateTo')[0]).toMatchObject({
      packageName: '@dpad-tv/test',
      page: 'concepts/focus.md',
      heading: 'navigateTo',
    });
    expect(search('long press')[0]?.page).toBe('concepts/keys.md');
    expect(search('msw handlers')[0]?.packageName).toBe('@dpad-tv/mock');
    expect(index.search('zebra')).toEqual([]);
  });

  it('trims long sections without leaving a code fence open', () => {
    const long = `intro\n\n\`\`\`ts\n${'x\n'.repeat(400)}\`\`\``;
    const out = excerpt(long, 100);
    expect(out.length).toBeLessThan(130);
    expect((out.match(/```/g) ?? []).length % 2).toBe(0);
    expect(out.endsWith('[...]')).toBe(true);
  });

  it('serves results through the docs_search tool without a config', async () => {
    const root = await project();
    const h = await connect({ config: null, docsRoots: [root] });
    const out = await h.ok('docs_search', { query: 'navigateTo path', limit: 2 });
    expect(out).toMatch(/^\[1\] @dpad-tv\/test > concepts\/focus\.md > navigateTo/);
    expect(out).toContain(
      `Path: ${join(root, 'node_modules/@dpad-tv/test/docs/concepts/focus.md')}`,
    );
    expect(out).toContain('await app.focus.navigateTo');
    expect(await h.ok('docs_search', { query: 'zebra' })).toContain('No docs match "zebra"');
  });

  it('always includes the docs shipped with this package', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'dpad-empty-'));
    const h = await connect({ config: null, docsRoots: [empty] });
    const out = await h.ok('docs_search', { query: 'Cursor MCP client setup' });
    expect(out).toContain('@dpad-tv/mcp > setup.md');
  });
});
