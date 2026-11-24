/**
 * Generates `llms.txt` (index) and `llms-full.txt` (every page) at build time, plus a clean
 * markdown copy of each page next to its HTML (`/concepts/focus.md`), which llms.txt links to.
 * Order follows the sidebar. See https://llmstxt.org.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import matter from 'gray-matter';
import type { SiteConfig } from 'vitepress';
import { listPackages, titleOf } from './packages.ts';
import { sections } from './sidebar.ts';

export interface LlmsPage {
  /** Site URL path, e.g. `/concepts/focus` or `/ci/`. */
  readonly url: string;
  readonly title: string;
  readonly description: string | undefined;
  /** Markdown ready for agents: no frontmatter, comments or VitePress-only syntax. */
  readonly markdown: string;
}

export interface LlmsGroup {
  readonly text: string;
  /** One line under the heading, e.g. a package description. */
  readonly summary?: string;
  readonly pages: readonly LlmsPage[];
  /** Listed under `## Optional`, left out of llms-full.txt. */
  readonly optional?: boolean;
}

/**
 * Package order in llms.txt: what test authors need first, implementers' packages last.
 * Packages not listed follow alphabetically.
 */
const PACKAGE_ORDER = [
  'test',
  'core',
  'mock',
  'driver-web',
  'driver-android-tv',
  'driver-tvos',
  'sdk',
  'sdk-react-native',
  'eslint-plugin',
  'mcp',
  'protocol',
];

export interface LlmsOptions {
  readonly title: string;
  readonly summary: string;
  readonly intro: string;
  /** Absolute origin for links, e.g. `https://example.dev`. Empty for root-relative links. */
  readonly origin: string;
}

/** Path of the markdown copy of a page: `/ci/` -> `/ci/index.md`, `/a/b` -> `/a/b.md`. */
export function markdownPath(url: string): string {
  return url.endsWith('/') ? `${url}index.md` : `${url}.md`;
}

/** Cleans one page's source for agent consumption. `readSnippet` resolves `<<< @/path` includes. */
export function cleanMarkdown(
  source: string,
  url: string,
  readSnippet: (path: string) => string,
): { title: string | undefined; description: string | undefined; markdown: string } {
  const { data, content } = matter(source);
  const base = url.endsWith('/') ? url : posix.dirname(url);
  const markdown = content
    .replace(/^<<<\s+@\/(\S+?)(?:\{(\w+)\})?\s*$/gm, (_, path: string, lang?: string) => {
      const ext = lang ?? posix.extname(path).slice(1);
      return '````' + ext + '\n' + readSnippet(path).trimEnd() + '\n````';
    })
    .replace(/<!--[\s\S]*?-->\n?/g, '')
    .replace(/\]\((?!https?:|\/|#|mailto:)([^)\s]+)\)/g, (_, target: string) => {
      const [path = '', hash] = target.split('#');
      const resolved = posix
        .normalize(posix.join(base, path))
        .replace(/\/index\.md$/, '/')
        .replace(/\.md$/, '');
      return `](${resolved}${hash ? `#${hash}` : ''})`;
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    title: titleOf(data, content),
    description: typeof data.description === 'string' ? data.description : firstParagraph(markdown),
    markdown,
  };
}

/**
 * The page's lead sentence, as a fallback description: the first block after the headings, when
 * it is prose. Pages that open with a list, table, fence or admonition get none.
 */
export function firstParagraph(markdown: string): string | undefined {
  const lead = markdown
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block && !block.startsWith('#'));
  if (!lead || /^([-*+] |\d+\. |\||>|:::|<|!\[|`{3}|~{3})/.test(lead)) return undefined;
  const line = lead.replace(/\s*\n\s*/g, ' ');
  const sentence = /^.+?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
  return sentence.length > 200 ? `${sentence.slice(0, 199).trimEnd()}…` : sentence;
}

export function renderIndex(groups: readonly LlmsGroup[], opts: LlmsOptions): string {
  const intro = opts.intro.trim().replace(/\]\(\//g, `](${opts.origin}/`);
  const lines = [`# ${opts.title}`, '', `> ${opts.summary}`, '', intro, ''];
  const link = (p: LlmsPage) =>
    `- [${p.title}](${opts.origin}${markdownPath(p.url)})${p.description ? `: ${p.description}` : ''}`;
  for (const g of groups.filter((g) => !g.optional && g.pages.length > 0)) {
    lines.push(`## ${g.text}`, '', ...(g.summary ? [g.summary, ''] : []), ...g.pages.map(link), '');
  }
  const optional = groups.filter((g) => g.optional).flatMap((g) => g.pages);
  lines.push(
    '## Optional',
    '',
    `- [Full documentation](${opts.origin}/llms-full.txt): every page in one file`,
  );
  lines.push(...optional.map(link), '');
  return lines.join('\n');
}

export function renderFull(pages: readonly LlmsPage[], opts: LlmsOptions): string {
  const body = pages.map((p) => {
    const source = `Source: ${opts.origin}${markdownPath(p.url)}`;
    const [first = '', ...rest] = p.markdown.split('\n');
    return first.startsWith('# ')
      ? [first, '', source, ...rest].join('\n')
      : [`# ${p.title}`, '', source, '', p.markdown].join('\n');
  });
  return [
    `# ${opts.title}`,
    '',
    `> ${opts.summary}`,
    '',
    ...body.flatMap((b) => [b, '', '---', '']),
  ]
    .join('\n')
    .trimEnd()
    .concat('\n');
}

/** VitePress `buildEnd` hook. */
export function generateLlms(config: SiteConfig, opts: Omit<LlmsOptions, 'origin'>): void {
  const origin = (process.env.TOETS_DOCS_URL ?? '').replace(/\/$/, '');
  const generated = new Set(config.dynamicRoutes.routes.map((r) => r.path));
  const sourceOf = new Map<string, string>();
  for (const page of config.pages) {
    const rewritten = config.rewrites.map[page] ?? page;
    const url = '/' + rewritten.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
    sourceOf.set(url, page);
  }

  const readSnippet = (path: string) => readFileSync(join(config.srcDir, path), 'utf8');
  const load = (url: string): LlmsPage | undefined => {
    const page = sourceOf.get(url);
    if (!page || generated.has(page)) return undefined; // dynamic routes are generated listings
    const clean = cleanMarkdown(readFileSync(join(config.srcDir, page), 'utf8'), url, readSnippet);
    const out = join(config.outDir, markdownPath(url));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, clean.markdown + '\n');
    return {
      url,
      title: clean.title ?? url,
      description: clean.description,
      markdown: clean.markdown,
    };
  };

  const pagesOf = (urls: readonly string[]) =>
    urls.map(load).filter((p): p is LlmsPage => p !== undefined);
  const rank = (dir: string) => {
    const i = PACKAGE_ORDER.indexOf(dir);
    return i === -1 ? PACKAGE_ORDER.length : i;
  };
  // Reference pages are grouped per package, so same-titled pages (`Setup`, `Capabilities`)
  // stay apart, and each group says what the package is.
  const packageGroups = (): LlmsGroup[] =>
    listPackages()
      .sort((a, b) => rank(a.dir) - rank(b.dir) || a.dir.localeCompare(b.dir))
      .map((pkg) => ({
        text: `Reference: ${pkg.name}`,
        summary: pkg.description,
        pages: pagesOf(pkg.pages.map((p) => p.link)),
      }));

  const groups = sections().flatMap((s): LlmsGroup[] => {
    if (s.text === 'Reference') {
      return [{ text: 'Reference', pages: pagesOf(['/reference/']) }, ...packageGroups()];
    }
    const urls: string[] = [];
    const walk = (items: typeof s.items) => {
      for (const item of items) {
        if (item.link) urls.push(item.link);
        if (item.items) walk(item.items);
      }
    };
    walk(s.items);
    return [{ text: s.text, optional: s.text === 'Agent skills', pages: pagesOf(urls) }];
  });

  const full = { ...opts, origin };
  writeFileSync(join(config.outDir, 'llms.txt'), renderIndex(groups, full));
  writeFileSync(
    join(config.outDir, 'llms-full.txt'),
    renderFull(
      groups.filter((g) => !g.optional).flatMap((g) => g.pages),
      full,
    ),
  );
}
