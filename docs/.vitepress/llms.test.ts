import { describe, expect, it } from 'vitest';
import { cleanMarkdown, markdownPath, renderFull, renderIndex, type LlmsPage } from './llms.ts';

const opts = { title: 'dpad', summary: 'TV E2E.', intro: 'Intro.', origin: 'https://x.dev' };

describe('cleanMarkdown', () => {
  const clean = (source: string, url = '/concepts/focus') =>
    cleanMarkdown(source, url, (path) => `contents of ${path}`);

  it('reads title and description, drops frontmatter and comments', () => {
    const out = clean(
      '---\ndescription: About focus.\n---\n\n# Focus\n\n<!-- examples: pending -->\nText.',
    );
    expect(out).toEqual({
      title: 'Focus',
      description: 'About focus.',
      markdown: '# Focus\n\nText.',
    });
  });

  it('makes relative links site-absolute', () => {
    const { markdown } = clean('[a](./idle.md) [b](../ci/index.md#x) [c](https://y.dev) [d](/e)');
    expect(markdown).toBe('[a](/concepts/idle) [b](/ci/#x) [c](https://y.dev) [d](/e)');
  });

  it('resolves links from index pages against their folder', () => {
    expect(clean('[a](./android.md)', '/ci/').markdown).toBe('[a](/ci/android)');
  });

  it('inlines VitePress snippet includes', () => {
    const { markdown } = clean('<<< @/docs/templates/AGENTS.md{md}');
    expect(markdown).toBe('````md\ncontents of docs/templates/AGENTS.md\n````');
  });
});

describe('rendering', () => {
  const page: LlmsPage = {
    url: '/concepts/focus',
    title: 'Focus',
    description: 'About focus.',
    markdown: '# Focus\n\nText.',
  };

  it('maps URLs to markdown copies', () => {
    expect(markdownPath('/ci/')).toBe('/ci/index.md');
    expect(markdownPath('/a/b')).toBe('/a/b.md');
  });

  it('renders an llms.txt index with an Optional section', () => {
    const index = renderIndex([{ text: 'Concepts', pages: [page] }], opts);
    expect(index).toContain('# dpad\n\n> TV E2E.\n\nIntro.\n\n## Concepts\n');
    expect(index).toContain('- [Focus](https://x.dev/concepts/focus.md): About focus.');
    expect(index).toContain('## Optional\n\n- [Full documentation](https://x.dev/llms-full.txt)');
  });

  it('renders every page with its source in llms-full.txt', () => {
    expect(renderFull([page], opts)).toContain(
      '# Focus\n\nSource: https://x.dev/concepts/focus.md\n\nText.',
    );
  });
});
