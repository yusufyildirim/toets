import { describe, expect, it } from 'vitest';
import { extractBlocks } from './extract.ts';

const page = (...lines: string[]) => lines.join('\n');

describe('extractBlocks', () => {
  it('returns checkable blocks with their markdown line', () => {
    const { blocks } = extractBlocks(
      page('# Title', '', '```ts', 'const a = 1;', '```', '', '```sh', 'ls', '```'),
      'a.md',
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ line: 4, lang: 'ts', code: 'const a = 1;', mode: 'check' });
  });

  it('reads modes from fence meta', () => {
    const { blocks } = extractBlocks(
      page('```ts run', 'a', '```', '```ts nocheck', 'b', '```', '```js pending', 'c', '```'),
      'a.md',
    );
    expect(blocks.map((b) => b.mode)).toEqual(['run', 'skip', 'pending']);
  });

  it('marks every block pending when the page has the marker, except nocheck', () => {
    const { pending, blocks } = extractBlocks(
      page('```ts', 'a', '```', '<!-- examples: pending -->', '```ts nocheck', 'b', '```'),
      'a.md',
    );
    expect(pending).toBe(true);
    expect(blocks.map((b) => b.mode)).toEqual(['pending', 'skip']);
  });

  it('ignores markers and fences inside code blocks', () => {
    const { pending, blocks } = extractBlocks(
      page('````md', '<!-- examples: pending -->', '```ts', 'x', '```', '````'),
      'a.md',
    );
    expect(pending).toBe(false);
    expect(blocks).toHaveLength(0);
  });

  it('strips list indentation and keeps it for column mapping', () => {
    const { blocks } = extractBlocks(
      page('1. Step', '', '   ```ts', '   const a = 1;', '   ```'),
      'a.md',
    );
    expect(blocks[0]).toMatchObject({ indent: 3, code: 'const a = 1;' });
  });

  it('accepts VitePress fence extras', () => {
    const { blocks } = extractBlocks(page('```ts{2} [config.ts]', 'a', '```'), 'a.md');
    expect(blocks[0]).toMatchObject({ lang: 'ts', meta: ['{2}', '[config.ts]'] });
  });

  it('never runs json', () => {
    const { blocks } = extractBlocks(page('```json run', '{}', '```'), 'a.md');
    expect(blocks[0]?.mode).toBe('check');
  });
});
