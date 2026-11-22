/**
 * Parity matrix reporter: which test ran on which platform, and why it was skipped where it
 * did not. Added by `defineConfig` (disable with `parityReport: false`).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { FullConfig, Reporter, Suite, TestCase } from '@playwright/test/reporter';

export interface ParityReporterOptions {
  /** Markdown matrix path; a `.json` twin is written next to it. Default `dpad-report/parity.md`. */
  readonly outputFile?: string;
  /** Print the one-line summary and diverging tests to stdout. Default true. */
  readonly summary?: boolean;
}

export type ParityStatus = 'passed' | 'failed' | 'flaky' | 'skipped' | 'not run';

export interface ParityCell {
  readonly status: ParityStatus;
  /** Skip reason, e.g. `requires key.color: not available on tvos`. */
  readonly reason?: string;
  /** Key overrides used, e.g. `FAST_FORWARD = hold RIGHT 800ms`. */
  readonly overrides?: readonly string[];
}

export interface ParityRow {
  /** `file > describe > test`. */
  readonly test: string;
  readonly cells: Readonly<Record<string, ParityCell>>;
}

export interface ParityMatrix {
  readonly projects: readonly string[];
  readonly rows: readonly ParityRow[];
}

function cellOf(test: TestCase): ParityCell {
  const outcome = test.outcome();
  const last = test.results.at(-1);
  const status: ParityStatus =
    outcome === 'skipped'
      ? last
        ? 'skipped'
        : 'not run'
      : outcome === 'expected'
        ? 'passed'
        : outcome === 'flaky'
          ? 'flaky'
          : 'failed';
  const annotations = [...test.annotations, ...(last?.annotations ?? [])];
  const reason = annotations.find(
    (a) => (a.type === 'skip' || a.type === 'fixme') && a.description,
  )?.description;
  const overrides = [
    ...new Set(
      annotations
        .filter((a) => a.type === 'dpad:key-override' && a.description)
        .map((a) => a.description as string),
    ),
  ];
  return {
    status,
    ...(status === 'skipped' && reason ? { reason } : {}),
    ...(overrides.length ? { overrides } : {}),
  };
}

/** Builds the matrix from a finished run. dpad projects only, when any exist. */
export function buildParityMatrix(root: Suite): ParityMatrix {
  const isDpad = (s: Suite) => !!(s.project()?.use as { dpad?: unknown } | undefined)?.dpad;
  const projectSuites = root.suites.filter((s) => s.project());
  const chosen = projectSuites.some(isDpad) ? projectSuites.filter(isDpad) : projectSuites;
  const projects = chosen.map((s) => s.title);
  const rows = new Map<string, Record<string, ParityCell>>();
  for (const suite of chosen) {
    for (const test of suite.allTests()) {
      const key = test.titlePath().slice(2).join(' > ');
      const row = rows.get(key) ?? {};
      row[suite.title] = cellOf(test);
      rows.set(key, row);
    }
  }
  return {
    projects,
    rows: [...rows].map(([test, cells]) => ({
      test,
      cells: Object.fromEntries(
        projects.map((p) => [p, cells[p] ?? { status: 'not run' as const }]),
      ),
    })),
  };
}

const escapeCell = (s: string) => s.replace(/\|/g, '\\|');

function describeCell(cell: ParityCell): string {
  let out: string = cell.status;
  if (cell.reason) out += ` (${cell.reason})`;
  if (cell.overrides?.length) out += ` [overrides: ${cell.overrides.join('; ')}]`;
  return out;
}

/** The matrix as a Markdown table, deterministic. */
export function formatParityMatrix(matrix: ParityMatrix): string {
  const lines = [
    '# dpad parity matrix',
    '',
    `| Test | ${matrix.projects.map(escapeCell).join(' | ')} |`,
    `| --- | ${matrix.projects.map(() => '---').join(' | ')} |`,
  ];
  for (const row of matrix.rows) {
    const cells = matrix.projects.map((p) => escapeCell(describeCell(row.cells[p] as ParityCell)));
    lines.push(`| ${escapeCell(row.test)} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n') + '\n';
}

/** One line per project plus the rows whose outcome differs across projects. */
export function summarizeParity(matrix: ParityMatrix): string {
  const counts = matrix.projects.map((p) => {
    const tally = new Map<ParityStatus, number>();
    for (const row of matrix.rows) {
      const s = (row.cells[p] as ParityCell).status;
      tally.set(s, (tally.get(s) ?? 0) + 1);
    }
    return `${p}: ${[...tally].map(([s, n]) => `${n} ${s}`).join(', ')}`;
  });
  const lines = [
    `dpad parity (${matrix.rows.length} tests): ${counts.join('; ') || 'no projects'}`,
  ];
  for (const row of matrix.rows) {
    const cells = matrix.projects.map((p) => describeCell(row.cells[p] as ParityCell));
    if (new Set(matrix.projects.map((p) => (row.cells[p] as ParityCell).status)).size > 1) {
      lines.push(
        `  differs: ${row.test}: ${matrix.projects.map((p, i) => `${p} ${cells[i]}`).join(', ')}`,
      );
    }
  }
  return lines.join('\n');
}

export default class ParityReporter implements Reporter {
  private root: Suite | null = null;

  constructor(private readonly options: ParityReporterOptions = {}) {}

  printsToStdio(): boolean {
    return false;
  }

  onBegin(_config: FullConfig, suite: Suite): void {
    this.root = suite;
  }

  onEnd(): void {
    if (!this.root) return;
    const matrix = buildParityMatrix(this.root);
    if (!matrix.projects.length) return;
    const out = resolve(this.options.outputFile ?? join('dpad-report', 'parity.md'));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, formatParityMatrix(matrix));
    writeFileSync(out.replace(/\.md$/, '') + '.json', JSON.stringify(matrix, null, 2) + '\n');
    if (this.options.summary !== false) {
      process.stdout.write(
        `\n${summarizeParity(matrix)}\nParity matrix: ${relative(process.cwd(), out)}\n`,
      );
    }
  }
}
