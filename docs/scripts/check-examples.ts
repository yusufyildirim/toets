/**
 * Type-checks (and, for `run` blocks, executes) code blocks in the docs site, package docs
 * and skills, so examples can not rot. `run` blocks that import `@dpad-tv/test` are Playwright
 * tests: they run in one Playwright Test invocation against the demo app (an in-memory TV app on
 * the core's FakeDriver, see `examples/demo-app/`); other `run` blocks run with Node. Usage:
 *
 *   node scripts/check-examples.ts [--list-pending]
 *
 * Packages resolve to the workspace sources (`@dpad-tv/source` condition).
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  globSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { extractBlocks, type CodeBlock, type ExtractedPage } from './examples/extract.ts';

const docsDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoDir = dirname(docsDir);
const cacheDir = join(docsDir, '.vitepress/cache/examples');
const demoConfig = join(docsDir, 'scripts/examples/demo-app/playwright.config.ts');

/** A `run` block that is a Playwright test file: it imports `@dpad-tv/test`. */
function isTestExample(block: CodeBlock): boolean {
  return block.mode === 'run' && /from ['"]@dpad-tv\/test['"]/.test(block.code);
}

/** Markdown checked by this script, relative to the repo root. */
const SOURCES = ['docs/**/*.md', 'packages/*/docs/**/*.md', 'skills/**/*.md'];
const IGNORED = ['**/node_modules/**', 'docs/.vitepress/**'];

interface Failure {
  readonly block: CodeBlock;
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

function main(): void {
  const args = process.argv.slice(2);
  const pages = collectPages();
  const blocks = pages.flatMap((p) => p.blocks);
  const checked = blocks.filter((b) => b.mode === 'check' || b.mode === 'run');

  rmSync(cacheDir, { recursive: true, force: true });
  const files = new Map<string, CodeBlock>();
  const failures: Failure[] = [];

  for (const block of checked) {
    if (block.lang === 'json') {
      failures.push(...checkJson(block));
      continue;
    }
    const name = isTestExample(block)
      ? `L${block.line}.spec.${block.lang}`
      : `L${block.line}.${block.lang}`;
    const file = join(cacheDir, block.file.replace(/\.md$/, ''), name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, block.code + '\n');
    files.set(file, block);
  }

  failures.push(...typecheck(files));

  const failedBlocks = new Set(failures.map((f) => f.block));
  let ran = 0;
  const tests = new Map<string, CodeBlock>();
  for (const [file, block] of files) {
    if (block.mode !== 'run') continue;
    if (failedBlocks.has(block)) {
      if (isTestExample(block)) unlinkSync(file);
      continue;
    }
    if (isTestExample(block)) {
      tests.set(file, block);
      continue;
    }
    failures.push(...execute(file, block));
    ran++;
  }
  if (tests.size > 0) {
    failures.push(...runTests(tests));
    ran += tests.size;
  }

  report(pages, blocks, failures, ran, args.includes('--list-pending'));
  if (failures.length > 0) process.exitCode = 1;
}

function collectPages(): ExtractedPage[] {
  const files = SOURCES.flatMap((pattern) => globSync(pattern, { cwd: repoDir, exclude: IGNORED }));
  return [...new Set(files)]
    .sort()
    .map((file) => extractBlocks(readFileSync(join(repoDir, file), 'utf8'), file));
}

function compilerOptions(): ts.CompilerOptions {
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
  };
}

function typecheck(files: ReadonlyMap<string, CodeBlock>): Failure[] {
  if (files.size === 0) return [];
  const program = ts.createProgram([...files.keys()], compilerOptions());
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

interface PlaywrightReport {
  readonly suites?: readonly ReportSuite[];
  readonly errors?: readonly ReportError[];
}
interface ReportSuite {
  readonly file: string;
  readonly specs?: readonly {
    readonly title: string;
    readonly tests: readonly {
      readonly results: readonly {
        readonly status: string;
        readonly errors: readonly ReportError[];
      }[];
    }[];
  }[];
  readonly suites?: readonly ReportSuite[];
}
interface ReportError {
  readonly message?: string;
  readonly location?: { readonly file: string; readonly line: number; readonly column: number };
}

/** Runs the test examples with Playwright Test against the demo app; one failure per test. */
function runTests(tests: ReadonlyMap<string, CodeBlock>): Failure[] {
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const reportFile = join(cacheDir, '.results', 'report.json');
  const result = spawnSync(process.execPath, [cli, 'test', '--config', demoConfig], {
    cwd: docsDir,
    encoding: 'utf8',
    timeout: 300_000,
    env: { ...process.env, DPAD_EXAMPLES_DIR: cacheDir, CI: '' },
  });
  const blockOf = (file: string) => tests.get(resolve(cacheDir, file)) ?? tests.get(file);
  /** At the error's line in the markdown when Playwright located it in the example. */
  const failure = (block: CodeBlock, message: string, error?: ReportError): Failure => {
    const at = error?.location && blockOf(error.location.file) === block ? error.location : null;
    return {
      block,
      line: at ? block.line + at.line - 1 : block.line,
      column: block.indent + (at ? at.column : 1),
      message: message.split('\n').slice(0, 20).join('\n'),
    };
  };
  if (!existsSync(reportFile)) {
    const output = `${result.stderr}${result.stdout}`.trim();
    return [...tests.values()].map((b) => failure(b, `Playwright did not run: ${output}`));
  }
  const report = JSON.parse(readFileSync(reportFile, 'utf8')) as PlaywrightReport;
  const failures: Failure[] = [];
  for (const error of report.errors ?? []) {
    const block = error.location ? blockOf(error.location.file) : undefined;
    const message = `test run failed: ${error.message ?? 'unknown error'}`;
    if (block) failures.push(failure(block, message, error));
    else failures.push(...[...tests.values()].map((b) => failure(b, message)));
  }
  const visit = (suite: ReportSuite, file: string): void => {
    const block = blockOf(file);
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        const bad = test.results.find((r) => r.status !== 'passed' && r.status !== 'skipped');
        if (bad && block) {
          const why = bad.errors.map((e) => e.message ?? '').join('\n') || bad.status;
          failures.push(
            failure(block, `test "${spec.title}" ${bad.status}: ${why}`, bad.errors[0]),
          );
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child, file);
  };
  for (const suite of report.suites ?? []) visit(suite, suite.file);
  return failures;
}

function report(
  pages: readonly ExtractedPage[],
  blocks: readonly CodeBlock[],
  failures: readonly Failure[],
  ran: number,
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
  console.log(
    [
      `examples: ${count('check') + count('run')} checked (${ran} run), ${count('pending')} pending on ${pendingPages.length} pages, ${count('skip')} nocheck`,
      failures.length === 0
        ? 'ok'
        : `${failures.length} problem${failures.length === 1 ? '' : 's'}`,
    ].join(' | '),
  );
}

main();
