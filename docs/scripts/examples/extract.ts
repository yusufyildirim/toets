/**
 * Extracts checkable code blocks from markdown.
 *
 * Markers (see docs/README.md):
 * - `<!-- examples: pending -->` anywhere on a page: its blocks wait for unimplemented APIs.
 * - Fence meta `pending`: same, for one block.
 * - Fence meta `nocheck`: never checked (fragments, sketches, output samples).
 * - Fence meta `run`: type-checked, then executed with Node.
 */

export type BlockMode = 'check' | 'run' | 'pending' | 'skip';

export type BlockLang = 'ts' | 'tsx' | 'js' | 'json';

export interface CodeBlock {
  /** Path of the markdown file, as given to {@link extractBlocks}. */
  readonly file: string;
  /** 1-based line of the first code line in the markdown file. */
  readonly line: number;
  /** Indentation stripped from every code line (fences inside lists). */
  readonly indent: number;
  readonly lang: BlockLang;
  readonly meta: readonly string[];
  readonly code: string;
  readonly mode: BlockMode;
}

export interface ExtractedPage {
  readonly file: string;
  readonly pending: boolean;
  readonly blocks: readonly CodeBlock[];
}

export const PENDING_MARKER = /<!--\s*examples:\s*pending\s*-->/;

const LANGS: Readonly<Record<string, BlockLang>> = {
  ts: 'ts',
  typescript: 'ts',
  mts: 'ts',
  tsx: 'tsx',
  js: 'js',
  javascript: 'js',
  mjs: 'js',
  json: 'json',
};

const FENCE_OPEN = /^( *)(`{3,}|~{3,})\s*([^\s`{[]*)(.*)$/;

export function extractBlocks(markdown: string, file: string): ExtractedPage {
  const lines = markdown.split(/\r?\n/);
  const raw: { line: number; indent: number; lang: string; meta: string[]; code: string }[] = [];
  let pending = false;

  for (let i = 0; i < lines.length; i++) {
    const current = lines[i] ?? '';
    const open = FENCE_OPEN.exec(current);
    if (!open) {
      if (PENDING_MARKER.test(current)) pending = true;
      continue;
    }
    const indent = open[1]?.length ?? 0;
    const fence = open[2] ?? '```';
    const lang = (open[3] ?? '').toLowerCase();
    const meta = (open[4] ?? '').split(/\s+/).filter(Boolean);
    const closing = new RegExp(
      `^ {0,${indent + 3}}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`,
    );
    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length && !closing.test(lines[j] ?? '')) {
      body.push(stripIndent(lines[j] ?? '', indent));
      j++;
    }
    raw.push({ line: i + 2, indent, lang, meta, code: body.join('\n') });
    i = j;
  }

  const blocks: CodeBlock[] = [];
  for (const b of raw) {
    const lang = LANGS[b.lang];
    if (!lang) continue;
    blocks.push({ file, ...b, lang, mode: modeOf(b.meta, pending, lang) });
  }
  return { file, pending, blocks };
}

function modeOf(meta: readonly string[], pagePending: boolean, lang: BlockLang): BlockMode {
  if (meta.includes('nocheck')) return 'skip';
  if (pagePending || meta.includes('pending')) return 'pending';
  if (meta.includes('run') && lang !== 'json') return 'run';
  return 'check';
}

function stripIndent(line: string, indent: number): string {
  let n = 0;
  while (n < indent && line[n] === ' ') n++;
  return line.slice(n);
}
