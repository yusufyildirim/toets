/**
 * Links in what a package ships (README and `docs/`) must work where it is read: on GitHub, on
 * npm and in `node_modules/@dpad-tv/<pkg>`. Relative links stay inside the package's shipped
 * files, except docs pages linking another package's docs as `../../<pkg>/docs/<page>.md`, which
 * resolves the same in the repo and in `node_modules/@dpad-tv/`. Anything else is an absolute
 * URL into the repository named by `repository` in package.json.
 */
import { existsSync, globSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..', '..');

interface Manifest {
  readonly name: string;
  readonly private?: boolean;
  readonly files?: readonly string[];
  readonly repository?: { readonly url: string; readonly directory?: string };
  readonly homepage?: string;
  readonly bugs?: string;
}

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Manifest;
const repoUrl = readJson(join(root, 'package.json'))
  .repository?.url.replace(/^git\+/, '')
  .replace(/\.git$/, '');

const packages = globSync('packages/*/package.json', { cwd: root })
  .map((file) => ({ dir: dirname(file), manifest: readJson(join(root, file)) }))
  .filter((p) => p.manifest.private !== true);

/** Markdown link targets, without code spans and fenced code. */
function linkTargets(markdown: string): string[] {
  const text = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  return [...text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]!);
}

/** Whether `path` (absolute) is shipped by the package at `pkgDir`. */
function shipped(pkgDir: string, files: readonly string[], path: string): boolean {
  const rel = relative(pkgDir, path).split(sep).join('/');
  if (rel.startsWith('..')) return false;
  if (/^(README|LICENSE|CHANGELOG)(\.md)?$/i.test(rel) || rel === 'package.json') return true;
  return files.some((entry) => rel === entry || rel.startsWith(`${entry.replace(/\/$/, '')}/`));
}

describe('package manifests', () => {
  it('have a repository URL at the root', () => {
    expect(repoUrl).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/);
  });

  it.each(packages)('$dir points at its folder of the repository', ({ dir, manifest }) => {
    expect(manifest.repository).toEqual({
      type: 'git',
      url: `git+${repoUrl}.git`,
      directory: dir,
    });
    expect(manifest.homepage).toBe(`${repoUrl}/tree/main/${dir}#readme`);
    expect(manifest.bugs).toBe(`${repoUrl}/issues`);
  });
});

describe('links in shipped markdown', () => {
  it.each(packages)('$dir', ({ dir, manifest }) => {
    const pkgDir = join(root, dir);
    const files = manifest.files ?? [];
    const pages = ['README.md', ...globSync('docs/**/*.md', { cwd: pkgDir })];
    const broken: string[] = [];
    for (const page of pages) {
      const file = join(pkgDir, page);
      if (!existsSync(file)) continue;
      for (const target of linkTargets(readFileSync(file, 'utf8'))) {
        const where = `${dir}/${page}: ${target}`;
        if (/^https?:\/\//.test(target)) {
          if (/github\.com\/[^/]+\/dpad\b/.test(target) && !target.startsWith(repoUrl!)) {
            broken.push(`${where} (not the repository URL ${repoUrl})`);
          }
          continue;
        }
        if (/^(#|mailto:)/.test(target)) continue;
        const path = resolve(dirname(file), decodeURIComponent(target.replace(/#.*$/, '')));
        if (!existsSync(path)) {
          broken.push(`${where} (missing)`);
          continue;
        }
        const otherDocs = relative(join(root, 'packages'), path)
          .split(sep)
          .join('/')
          .match(/^([^/]+)\/docs\//);
        const crossPackageDocs = page.startsWith('docs/') && otherDocs !== null;
        if (!shipped(pkgDir, files, path) && !crossPackageDocs) {
          broken.push(`${where} (not shipped; use an absolute ${repoUrl} URL)`);
        }
      }
    }
    expect(broken).toEqual([]);
  });
});
