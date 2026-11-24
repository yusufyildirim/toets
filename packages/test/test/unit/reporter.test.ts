import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FullConfig, Suite, TestCase } from '@playwright/test/reporter';
import { describe, expect, it } from 'vitest';
import ParityReporter, {
  buildParityMatrix,
  formatParityMatrix,
  summarizeParity,
  type ParityMatrix,
} from '../../src/reporter.js';

type Outcome = ReturnType<TestCase['outcome']>;

interface FakeTest {
  title: string;
  outcome: Outcome;
  ran?: boolean;
  annotations?: TestCase['annotations'];
}

function projectSuite(name: string, tests: FakeTest[], toets = true): Suite {
  const cases = tests.map(
    (t) =>
      ({
        titlePath: () => ['', name, 'home.spec.ts', t.title],
        outcome: () => t.outcome,
        annotations: t.annotations ?? [],
        results: t.ran === false ? [] : [{ annotations: [] }],
      }) as unknown as TestCase,
  );
  return {
    title: name,
    project: () => ({ name, use: toets ? { toets: {} } : {} }),
    allTests: () => cases,
  } as unknown as Suite;
}

const root = (...suites: Suite[]) => ({ suites }) as unknown as Suite;

describe('buildParityMatrix', () => {
  it('lines up tests across toets projects with statuses, skip reasons and overrides', () => {
    const matrix = buildParityMatrix(
      root(
        projectSuite('web', [
          { title: 'color keys', outcome: 'expected' },
          { title: 'fast forward', outcome: 'flaky' },
          { title: 'web only', outcome: 'unexpected' },
        ]),
        projectSuite('tvos', [
          {
            title: 'color keys',
            outcome: 'skipped',
            annotations: [
              { type: 'skip', description: 'requires key.color: not available on tvos' },
            ],
          },
          {
            title: 'fast forward',
            outcome: 'expected',
            annotations: [
              { type: 'toets:key-override', description: 'FAST_FORWARD = hold RIGHT 800ms' },
            ],
          },
          { title: 'interrupted', outcome: 'skipped', ran: false },
        ]),
        projectSuite('unit', [{ title: 'other', outcome: 'expected' }], false),
      ),
    );
    expect(matrix).toEqual({
      projects: ['web', 'tvos'],
      rows: [
        {
          test: 'home.spec.ts > color keys',
          cells: {
            web: { status: 'passed' },
            tvos: { status: 'skipped', reason: 'requires key.color: not available on tvos' },
          },
        },
        {
          test: 'home.spec.ts > fast forward',
          cells: {
            web: { status: 'flaky' },
            tvos: { status: 'passed', overrides: ['FAST_FORWARD = hold RIGHT 800ms'] },
          },
        },
        {
          test: 'home.spec.ts > web only',
          cells: { web: { status: 'failed' }, tvos: { status: 'not run' } },
        },
        {
          test: 'home.spec.ts > interrupted',
          cells: { web: { status: 'not run' }, tvos: { status: 'not run' } },
        },
      ],
    });
  });

  it('falls back to all projects when none is a toets project', () => {
    const matrix = buildParityMatrix(
      root(projectSuite('a', [{ title: 't', outcome: 'expected' }], false)),
    );
    expect(matrix.projects).toEqual(['a']);
  });
});

const matrix: ParityMatrix = {
  projects: ['web', 'tvos'],
  rows: [
    { test: 'a.spec.ts > same', cells: { web: { status: 'passed' }, tvos: { status: 'passed' } } },
    {
      test: 'a.spec.ts > a | b',
      cells: {
        web: { status: 'passed' },
        tvos: { status: 'skipped', reason: 'requires key.color: not available on tvos' },
      },
    },
  ],
};

describe('formatParityMatrix', () => {
  it('renders a Markdown table with escaped pipes', () => {
    expect(formatParityMatrix(matrix)).toBe(
      [
        '# toets parity matrix',
        '',
        '| Test | web | tvos |',
        '| --- | --- | --- |',
        '| a.spec.ts > same | passed | passed |',
        '| a.spec.ts > a \\| b | passed | skipped (requires key.color: not available on tvos) |',
        '',
      ].join('\n'),
    );
  });
});

describe('summarizeParity', () => {
  it('counts per project and lists diverging tests', () => {
    expect(summarizeParity(matrix)).toBe(
      [
        'toets parity (2 tests): web: 2 passed; tvos: 1 passed, 1 skipped',
        '  differs: a.spec.ts > a | b: web passed, tvos skipped (requires key.color: not available on tvos)',
      ].join('\n'),
    );
  });
});

describe('ParityReporter', () => {
  it('resolves a relative outputFile against the config directory, like Playwright', () => {
    const dir = mkdtempSync(join(tmpdir(), 'toets-parity-'));
    try {
      const reporter = new ParityReporter({ outputFile: '../report/parity.md', summary: false });
      const config = { configFile: join(dir, 'e2e', 'playwright.config.ts') } as FullConfig;
      reporter.onBegin(config, root(projectSuite('web', [{ title: 't', outcome: 'expected' }])));
      reporter.onEnd();
      expect(existsSync(join(dir, 'report', 'parity.md'))).toBe(true);
      expect(existsSync(join(dir, 'report', 'parity.json'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
