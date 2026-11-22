/**
 * Search over the `docs/` folders shipped inside installed `@dpad-tv/*` packages (decision 12:
 * docs ship with the packages, version-matched). Pages are split into heading sections and
 * ranked with BM25, so results are small excerpts an agent can read in place.
 */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A docs folder and the package it belongs to. */
export interface DocsSource {
  readonly packageName: string;
  readonly dir: string;
}

/** One heading section of a docs page. */
export interface DocsSection {
  readonly packageName: string;
  /** Page path inside the docs folder, `/`-separated (e.g. `rules/no-sleep.md`). */
  readonly page: string;
  /** Absolute file path. */
  readonly path: string;
  readonly pageTitle: string;
  readonly heading: string;
  /** Markdown of the section, heading included. */
  readonly text: string;
}

export interface DocsHit extends DocsSection {
  readonly score: number;
}

const SCOPE = '@dpad-tv';

/**
 * Finds docs folders of `@dpad-tv/*` packages in every `node_modules` above each root, plus the
 * docs of this package and its dependencies, plus `extraDirs`. Deduplicated by real path.
 */
export function findDocsSources(
  roots: readonly string[],
  extraDirs: readonly string[] = [],
): DocsSource[] {
  const seen = new Set<string>();
  const sources: DocsSource[] = [];
  const add = (packageName: string, dir: string): void => {
    if (!isDir(dir)) return;
    const real = realpathSync(dir);
    if (seen.has(real)) return;
    seen.add(real);
    sources.push({ packageName, dir: real });
  };

  const own = ownPackageRoot();
  if (own) add(`${SCOPE}/mcp`, join(own, 'docs'));
  const allRoots = own ? [...roots, own, realpathSync(own)] : roots;

  for (const root of allRoots) {
    for (let dir = root; ; dir = dirname(dir)) {
      const scope = join(dir, 'node_modules', SCOPE);
      if (isDir(scope)) {
        for (const pkg of readdirSync(scope).sort())
          add(`${SCOPE}/${pkg}`, join(scope, pkg, 'docs'));
      }
      if (dirname(dir) === dir) break;
    }
  }
  for (const dir of extraDirs) add(basename(dir), dir);
  return sources;
}

/** In-memory BM25 index over docs sections. Build once; docs do not change while running. */
export class DocsIndex {
  private readonly docs: { section: DocsSection; tf: Map<string, number>; length: number }[];
  private readonly df = new Map<string, number>();
  private readonly avgLength: number;

  private constructor(
    sections: readonly DocsSection[],
    readonly sources: readonly DocsSource[],
  ) {
    this.docs = sections.map((section) => {
      const tf = new Map<string, number>();
      const body = tokenize(section.text);
      const bump = (tokens: string[], weight: number): void => {
        for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + weight);
      };
      bump(body, 1);
      bump(tokenize(section.heading), 3);
      bump(tokenize(section.pageTitle), 1);
      bump(tokenize(section.page), 1);
      for (const t of tf.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
      return { section, tf, length: body.length };
    });
    this.avgLength = this.docs.reduce((s, d) => s + d.length, 0) / Math.max(1, this.docs.length);
  }

  static async build(sources: readonly DocsSource[]): Promise<DocsIndex> {
    const sections: DocsSection[] = [];
    for (const source of sources) {
      for (const path of await markdownFiles(source.dir)) {
        const page = relative(source.dir, path).split(sep).join('/');
        sections.push(
          ...splitSections(await readFile(path, 'utf8'), source.packageName, page, path),
        );
      }
    }
    return new DocsIndex(sections, sources);
  }

  get sectionCount(): number {
    return this.docs.length;
  }

  /** Best sections for `query`, highest score first. */
  search(query: string, limit = 5): DocsHit[] {
    const terms = [...new Set(tokenize(query))];
    const phrase = query.trim().toLowerCase();
    const n = this.docs.length;
    const k1 = 1.2;
    const b = 0.75;
    const hits: DocsHit[] = [];
    for (const doc of this.docs) {
      let score = 0;
      for (const term of terms) {
        const tf = doc.tf.get(term);
        if (!tf) continue;
        const df = this.df.get(term) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * doc.length) / this.avgLength));
      }
      if (score > 0 && phrase.length > 2 && doc.section.text.toLowerCase().includes(phrase)) {
        score *= 1.5;
      }
      if (score > 0) hits.push({ ...doc.section, score });
    }
    return hits.sort((x, y) => y.score - x.score).slice(0, limit);
  }
}

/** Trims a section to about `max` characters at a paragraph or line boundary. */
export function excerpt(text: string, max = 1200): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('\n'));
  const head = at > max / 2 ? cut.slice(0, at) : cut;
  // Never leave a code fence open.
  const fences = head.match(/^(```|~~~)/gm)?.length ?? 0;
  return `${head}${fences % 2 ? '\n```' : ''}\n[...]`;
}

/** Splits a markdown page into sections at `#`, `##` and `###` headings outside code fences. */
export function splitSections(
  markdown: string,
  packageName: string,
  page: string,
  path: string,
): DocsSection[] {
  const lines = markdown.split(/\r?\n/);
  const pageTitle =
    lines
      .find((l) => /^#\s+/.test(l))
      ?.replace(/^#\s+/, '')
      .trim() ?? basename(page, '.md');
  const sections: DocsSection[] = [];
  let heading = pageTitle;
  let buffer: string[] = [];
  let fence: string | null = null;
  const flush = (): void => {
    const text = buffer.join('\n').trim();
    if (text) sections.push({ packageName, page, path, pageTitle, heading, text });
    buffer = [];
  };
  for (const line of lines) {
    const marker = /^\s*(```|~~~)/.exec(line)?.[1];
    if (marker) fence = fence === null ? marker : fence === marker ? null : fence;
    const h = fence === null && !marker ? /^(#{1,3})\s+(.+)$/.exec(line) : null;
    if (h?.[2]) {
      flush();
      heading = h[2].trim();
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

const STOP_WORDS = new Set(
  'a an and are as at be by do does for from how i in is it its me my of on or the this to use what when where which with you your'.split(
    ' ',
  ),
);

/** Lowercased word tokens; identifiers also yield their camelCase / snake_case parts. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const word of text.match(/[A-Za-z0-9_]+/g) ?? []) {
    out.push(stem(word.toLowerCase()));
    const parts = word.split(/_|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean);
    if (parts.length > 1) for (const p of parts) out.push(stem(p.toLowerCase()));
  }
  return out.filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/** Tiny plural folding: `keys` -> `key`, `capabilities` -> `capability`; keeps `focus`, `class`. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

async function markdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
      out.push(...(await markdownFiles(path)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(path);
    }
  }
  return out;
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Root folder of this package (works from `src/` and from the built `dist/`). */
function ownPackageRoot(): string | null {
  for (let dir = dirname(fileURLToPath(import.meta.url)); ; dir = dirname(dir)) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      try {
        const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown };
        return pkg.name === `${SCOPE}/mcp` ? dir : null;
      } catch {
        return null;
      }
    }
    if (dirname(dir) === dir) return null;
  }
}
