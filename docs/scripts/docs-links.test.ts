/**
 * Every docs path an error can carry (`ToetsError.docs`, `ProtocolError.docs`, ESLint rule URLs)
 * must name a page of the docs site. Sources are scanned for the literal forms they use:
 * `docsLink('<guide page>')`, `packageDocsLink('<pkg>', '<page>')` and `'reference/<pkg>/docs/<page>'`.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** Repository file of a docs site path (see the rewrites in `.vitepress/config.ts`). */
function pageFile(path: string): string | undefined {
  const pkg = /^reference\/([^/]+)\/docs\/(.+)$/.exec(path);
  const candidates = pkg
    ? [`packages/${pkg[1]}/docs/${pkg[2]}.md`]
    : [`docs/${path}.md`, `docs/${path}/index.md`];
  return candidates.find((file) => existsSync(join(root, file)));
}

interface Reference {
  readonly file: string;
  readonly path: string;
}

function references(): Reference[] {
  const out: Reference[] = [];
  const packages = readdirSync(join(root, 'packages'));
  for (const pkg of packages) {
    const src = join(root, 'packages', pkg, 'src');
    if (!existsSync(src)) continue;
    for (const file of sourceFiles(src)) {
      const text = readFileSync(file, 'utf8');
      const at = relative(root, file);
      for (const m of text.matchAll(/\bdocsLink\('([^']+)'\)/g))
        out.push({ file: at, path: m[1]! });
      for (const m of text.matchAll(/\bpackageDocsLink\('([^']+)',\s*'([^']+)'\)/g)) {
        out.push({ file: at, path: `reference/${m[1]}/docs/${m[2]}` });
      }
      for (const m of text.matchAll(/'(reference\/[^'$]+\/docs\/[^'$]+)'/g)) {
        out.push({ file: at, path: m[1]! });
      }
    }
  }
  return out;
}

describe('docs paths in package sources', () => {
  const found = references();

  it('finds the references', () => {
    expect(found.length).toBeGreaterThan(30);
  });

  it('point at existing pages', () => {
    const broken = found.filter((r) => pageFile(r.path) === undefined);
    expect(broken.map((r) => `${r.file}: ${r.path}`)).toEqual([]);
  });

  it('use no other literal form', () => {
    const stray: string[] = [];
    for (const pkg of readdirSync(join(root, 'packages'))) {
      const src = join(root, 'packages', pkg, 'src');
      if (!existsSync(src)) continue;
      for (const file of sourceFiles(src)) {
        for (const m of readFileSync(file, 'utf8').matchAll(/\bdocs: '([^']+)'/g)) {
          if (!m[1]!.startsWith('reference/')) stray.push(`${relative(root, file)}: ${m[1]}`);
        }
      }
    }
    expect(stray).toEqual([]);
  });

  it('cover every ESLint rule page', () => {
    const rules = readdirSync(join(root, 'packages/eslint-plugin/src/rules')).map((f) =>
      f.replace(/\.ts$/, ''),
    );
    for (const rule of rules) {
      expect(pageFile(`reference/eslint-plugin/docs/rules/${rule}`), rule).toBeDefined();
    }
  });
});
