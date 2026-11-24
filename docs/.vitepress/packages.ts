/**
 * Package docs discovery. Each package owns `packages/<pkg>/docs/**.md`; the site serves them at
 * `/reference/<pkg>/docs/<page>` (see the rewrites in config.ts) without copying them.
 *
 * The URL keeps the `docs` segment on purpose: a link from one package's docs to another's,
 * written as `../../core/docs/page.md`, then works in the repo, in `node_modules/@toets/` and
 * on the site alike.
 */
import { existsSync, globSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

export const repoDir = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export interface PackageDocPage {
  /** Path relative to the package's `docs/` folder, without `.md`. */
  readonly page: string;
  readonly title: string;
  readonly description: string | undefined;
  readonly link: string;
  readonly order: number;
}

export interface PackageInfo {
  /** Folder name under `packages/`, also the URL segment. */
  readonly dir: string;
  readonly name: string;
  readonly description: string;
  readonly private: boolean;
  readonly pages: readonly PackageDocPage[];
}

export function listPackages(): PackageInfo[] {
  return globSync('packages/*/package.json', { cwd: repoDir })
    .map((file) => {
      const dir = basename(dirname(file));
      const pkg = JSON.parse(readFileSync(join(repoDir, file), 'utf8')) as {
        name: string;
        description?: string;
        private?: boolean;
      };
      return {
        dir,
        name: pkg.name,
        description: pkg.description ?? '',
        private: pkg.private === true,
        pages: listPages(dir),
      };
    })
    .filter((p) => !p.private)
    .sort((a, b) => a.dir.localeCompare(b.dir));
}

function listPages(dir: string): PackageDocPage[] {
  const docs = join(repoDir, 'packages', dir, 'docs');
  if (!existsSync(docs)) return [];
  return globSync('**/*.md', { cwd: docs })
    .map((file) => {
      const { data, content } = matter(readFileSync(join(docs, file), 'utf8'));
      const page = file.replace(/\.md$/, '');
      return {
        page,
        title: titleOf(data, content) ?? page,
        description: typeof data.description === 'string' ? data.description : undefined,
        link: `/reference/${dir}/docs/${page === 'index' ? '' : page}`,
        order: typeof data.order === 'number' ? data.order : page === 'index' ? -1 : 0,
      };
    })
    .sort((a, b) => a.order - b.order || a.page.localeCompare(b.page));
}

/** Frontmatter `title`, else the first `# heading`. */
export function titleOf(data: Record<string, unknown>, content: string): string | undefined {
  if (typeof data.title === 'string') return data.title;
  return /^#\s+(.+)$/m.exec(content)?.[1]?.trim();
}
