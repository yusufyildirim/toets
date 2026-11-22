/**
 * Type-checks (and, for `run` blocks, executes) code blocks in the docs site, package docs
 * and skills, so examples can not rot. Usage:
 *
 *   node scripts/check-examples.ts [--resolve=auto|contract|real] [--list-pending]
 *
 * `--resolve` picks what `@dpad-tv/test` and `@dpad-tv/mock` resolve to:
 * - `contract`: the phase 1 stand-ins in `scripts/examples/contract/`.
 * - `real`: the workspace packages (source).
 * - `auto` (default): `real` for packages that export something, `contract` otherwise.
 */
import { spawnSync } from 'node:child_process';
import { globSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { extractBlocks, type CodeBlock, type ExtractedPage } from './examples/extract.ts';

const docsDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoDir = dirname(docsDir);
const cacheDir = join(docsDir, '.vitepress/cache/examples');
const contractDir = join(docsDir, 'scripts/examples/contract');

/** Markdown checked by this script, relative to the repo root. */
const SOURCES = ['docs/**/*.md', 'packages/*/docs/**/*.md', 'skills/**/*.md'];
const IGNORED = ['**/node_modules/**', 'docs/.vitepress/**'];

/** Packages that may resolve to a contract stand-in, by stub file. */
const STUBBED: Readonly<Record<string, { stub: string; source: string }>> = {
  '@dpad-tv/test': { stub: 'test.d.ts', source: 'packages/test/src/index.ts' },
  '@dpad-tv/mock': { stub: 'mock.d.ts', source: 'packages/mock/src/index.ts' },
};

type Resolve = 'auto' | 'contract' | 'real';

interface Failure {
  readonly block: CodeBlock;
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

function main(): void {
  const args = process.argv.slice(2);
  const resolve = (args.find((a) => a.startsWith('--resolve='))?.split('=')[1] ??
    'auto') as Resolve;
  if (!['auto', 'contract', 'real'].includes(resolve)) {
    fail(`Unknown --resolve=${resolve}. Use auto, contract or real.`);
  }

  const pages = collectPages();
  const blocks = pages.flatMap((p) => p.blocks);
  const checked = blocks.filter((b) => b.mode === 'check' || b.mode === 'run');
  const stubs = stubbedModules(resolve);

  rmSync(cacheDir, { recursive: true, force: true });
  const files = new Map<string, CodeBlock>();
  const failures: Failure[] = [];

  for (const block of checked) {
    if (block.lang === 'json') {
      failures.push(...checkJson(block));
      continue;
    }
    const file = join(cacheDir, block.file.replace(/\.md$/, ''), `L${block.line}.${block.lang}`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, block.code + '\n');
    files.set(file, block);
  }

  failures.push(...typecheck(files, stubs));

  const failedBlocks = new Set(failures.map((f) => f.block));
  let ran = 0;
  for (const [file, block] of files) {
    if (block.mode !== 'run' || failedBlocks.has(block)) continue;
    failures.push(...execute(file, block));
    ran++;
  }

  report(pages, blocks, failures, ran, stubs, args.includes('--list-pending'));
  if (failures.length > 0) process.exitCode = 1;
}

function collectPages(): ExtractedPage[] {
  const files = SOURCES.flatMap((pattern) => globSync(pattern, { cwd: repoDir, exclude: IGNORED }));
  return [...new Set(files)]
    .sort()
    .map((file) => extractBlocks(readFileSync(join(repoDir, file), 'utf8'), file));
}

function stubbedModules(resolve: Resolve): string[] {
  if (resolve === 'real') return [];
  return Object.entries(STUBBED)
    .filter(([, { source }]) => resolve === 'contract' || !exportsAnything(join(repoDir, source)))
    .map(([name]) => name);
}

function exportsAnything(file: string): boolean {
  const code = readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\s+/g, '');
  return code !== '' && code !== 'export{};';
}

function compilerOptions(stubs: readonly string[]): ts.CompilerOptions {
  const base = ts.readConfigFile(join(repoDir, 'tsconfig.base.json'), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(base.config, ts.sys, repoDir);
  return {
    ...options,
    noEmit: true,
    declaration: false,
    sourceMap: false,
    allowJs: true,
    checkJs: true,
    jsx: ts.JsxEmit.Preserve,
    moduleDetection: ts.ModuleDetectionKind.Force,
    allowImportingTsExtensions: true,
    customConditions: ['@dpad-tv/source'],
    types: ['node'],
    typeRoots: [join(docsDir, 'node_modules/@types')],
    paths: Object.fromEntries(
      stubs.map((name) => [name, [join(contractDir, STUBBED[name]?.stub ?? '')]]),
    ),
  };
}

function typecheck(files: ReadonlyMap<string, CodeBlock>, stubs: readonly string[]): Failure[] {
  if (files.size === 0) return [];
  const program = ts.createProgram([...files.keys()], compilerOptions(stubs));
  const failures: Failure[] = [];
  for (const [file, block] of files) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    const diagnostics = [
      ...program.getSyntacticDiagnostics(source),
      ...program.getSemanticDiagnostics(source),
    ];
    for (const d of diagnostics) {
      const pos =
        d.start === undefined
          ? { line: 0, character: 0 }
          : source.getLineAndCharacterOfPosition(d.start);
      failures.push({
        block,
        line: block.line + pos.line,
        column: block.indent + pos.character + 1,
        message: `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`,
      });
    }
  }
  return failures;
}

function checkJson(block: CodeBlock): Failure[] {
  try {
    JSON.parse(block.code);
    return [];
  } catch (error) {
    return [{ block, line: block.line, column: block.indent + 1, message: String(error) }];
  }
}

function execute(file: string, block: CodeBlock): Failure[] {
  const result = spawnSync(process.execPath, [file], {
    cwd: dirname(file),
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (result.status === 0) return [];
  const output = `${result.stderr}${result.stdout}`.trim().split('\n').slice(0, 20).join('\n');
  const reason = result.error ? String(result.error) : `exit code ${result.status}`;
  return [
    {
      block,
      line: block.line,
      column: block.indent + 1,
      message: `run failed (${reason})\n${output}`,
    },
  ];
}

function report(
  pages: readonly ExtractedPage[],
  blocks: readonly CodeBlock[],
  failures: readonly Failure[],
  ran: number,
  stubs: readonly string[],
  listPending: boolean,
): void {
  const count = (mode: CodeBlock['mode']) => blocks.filter((b) => b.mode === mode).length;
  const sorted = [...failures].sort(
    (a, b) => a.block.file.localeCompare(b.block.file) || a.line - b.line,
  );
  for (const f of sorted) {
    console.error(`${f.block.file}:${f.line}:${f.column} ${f.message}`);
  }
  const pendingPages = pages.filter((p) => p.blocks.some((b) => b.mode === 'pending'));
  if (listPending) {
    for (const p of pendingPages) {
      const n = p.blocks.filter((b) => b.mode === 'pending').length;
      console.log(
        `pending: ${p.file} (${n} block${n === 1 ? '' : 's'}${p.pending ? ', whole page' : ''})`,
      );
    }
  }
  const resolved =
    stubs.length > 0 ? `contract stand-ins for ${stubs.join(', ')}` : 'real packages';
  console.log(
    [
      `examples: ${count('check') + count('run')} checked (${ran} run), ${count('pending')} pending on ${pendingPages.length} pages, ${count('skip')} nocheck`,
      `resolved against ${resolved}`,
      failures.length === 0
        ? 'ok'
        : `${failures.length} problem${failures.length === 1 ? '' : 's'}`,
    ].join(' | '),
  );
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

main();
