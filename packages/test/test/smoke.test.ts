/**
 * End-to-end smoke: runs real Playwright Test with `@toets/test` against fake driver modules
 * (test/e2e). Covers config loading, driver module resolution, external devices, the `app`
 * fixture, steps, requires skipping, serial sharing, SDK and mock wiring, matchers, snapshot
 * baselines, failure dumps and the parity matrix.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ParityMatrix } from '../src/reporter.js';

const here = dirname(new URL(import.meta.url).pathname);
const config = join(here, 'e2e', 'playwright.config.ts');
const cli = join(
  dirname(createRequire(import.meta.url).resolve('@playwright/test/package.json')),
  'cli.js',
);
const root = mkdtempSync(join(tmpdir(), 'toets-smoke-'));

afterAll(() => rmSync(root, { recursive: true, force: true }));

interface RunResult {
  status: number | null;
  output: string;
  dir: string;
}

function playwright(dir: string, args: string[], env: Record<string, string> = {}): RunResult {
  const result = spawnSync(process.execPath, [cli, 'test', '-c', config, ...args], {
    cwd: here,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: '--conditions=@toets/source',
      TOETS_SMOKE_DIR: join(root, dir),
      CI: '',
      ...env,
    },
    timeout: 120_000,
  });
  return {
    status: result.status,
    output: `${result.stdout}\n${result.stderr}`,
    dir: join(root, dir),
  };
}

interface JsonAttachment {
  name: string;
  contentType: string;
  body?: string;
  path?: string;
}
interface JsonResult {
  status: string;
  attachments: JsonAttachment[];
  errors: { message?: string }[];
  steps?: JsonStep[];
}
interface JsonStep {
  title: string;
  steps?: JsonStep[];
}
interface JsonTest {
  projectName: string;
  results: JsonResult[];
  annotations: { type: string; description?: string }[];
}
interface JsonSpec {
  title: string;
  tests: JsonTest[];
}
interface JsonSuite {
  title: string;
  specs: JsonSpec[];
  suites?: JsonSuite[];
}

function tests(
  dir: string,
): { title: string; project: string; test: JsonTest; result: JsonResult }[] {
  const report = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as {
    suites: JsonSuite[];
  };
  const out: { title: string; project: string; test: JsonTest; result: JsonResult }[] = [];
  const walk = (suite: JsonSuite, prefix: string[]) => {
    const path = suite.title.endsWith('.ts') ? prefix : [...prefix, suite.title];
    for (const spec of suite.specs) {
      for (const test of spec.tests) {
        out.push({
          title: [...path, spec.title].join(' > '),
          project: test.projectName,
          test,
          result: test.results.at(-1) as JsonResult,
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, path);
  };
  for (const suite of report.suites) walk(suite, []);
  return out;
}

const stepTitles = (steps: JsonStep[] = []): string[] =>
  steps.flatMap((s) => [s.title, ...stepTitles(s.steps)]);

describe('@toets/test end to end', () => {
  let first: RunResult;
  beforeAll(() => {
    first = playwright('main', ['--update-snapshots=missing']);
  }, 150_000);

  it('passes the suite on both platforms', () => {
    expect(first.status, first.output).toBe(0);
    const statuses = Object.fromEntries(
      tests(first.dir).map((t) => [`${t.project}: ${t.title}`, t.result.status]),
    );
    expect(statuses).toEqual({
      'web: opens details from the rail': 'passed',
      'web: color keys work': 'passed',
      'web: player > toggles playback': 'passed',
      'web: loads home through the mock server': 'passed',
      'web: fast forward': 'passed',
      'web: launches into a state with the SDK': 'passed',
      'web: a serial flow shares one app > step 1: launch and move': 'passed',
      'web: a serial flow shares one app > step 2: still there': 'passed',
      'web: a test after the serial block starts isolated': 'passed',
      'web: home looks right': 'passed',
      'tvos: opens details from the rail': 'passed',
      'tvos: color keys work': 'skipped',
      'tvos: player > toggles playback': 'skipped',
      'tvos: loads home through the mock server': 'skipped',
      'tvos: fast forward': 'passed',
      'tvos: launches into a state with the SDK': 'skipped',
      'tvos: a serial flow shares one app > step 1: launch and move': 'passed',
      'tvos: a serial flow shares one app > step 2: still there': 'passed',
      'tvos: a test after the serial block starts isolated': 'passed',
      'tvos: home looks right': 'passed',
    });
  });

  it('reports every action as a step, with per-step snapshots where configured', () => {
    const web = tests(first.dir).find(
      (t) => t.project === 'web' && t.title === 'opens details from the rail',
    );
    const titles = stepTitles(web?.result.steps);
    expect(titles).toContain('launch');
    expect(titles).toContain("navigateTo getByTestId('card_2')");
    expect(titles).toContain('press SELECT');
    expect(web?.result.attachments.some((a) => a.name === 'step-snapshot')).toBe(true);
  });

  it('attaches the mock server traffic as a HAR', () => {
    const web = tests(first.dir).find(
      (t) => t.project === 'web' && t.title === 'loads home through the mock server',
    );
    const har = web?.result.attachments.find((a) => a.name === 'toets-network.har');
    expect(har?.contentType).toBe('application/json');
    const body = har?.body ? Buffer.from(har.body, 'base64').toString('utf8') : '';
    expect(JSON.parse(body).log.entries).toHaveLength(1);
  });

  it('flags key overrides on the test', () => {
    const tvos = tests(first.dir).find((t) => t.project === 'tvos' && t.title === 'fast forward');
    expect(tvos?.test.annotations).toContainEqual({
      type: 'toets:key-override',
      description: 'FAST_FORWARD = hold RIGHT 800ms',
    });
    expect(stepTitles(tvos?.result.steps)).toContain(
      'press FAST_FORWARD (override: hold RIGHT 800ms)',
    );
  });

  it('writes the parity matrix', () => {
    const matrix = JSON.parse(readFileSync(join(first.dir, 'parity.json'), 'utf8')) as ParityMatrix;
    expect(matrix.projects).toEqual(['web', 'tvos']);
    const color = matrix.rows.find((r) => r.test === 'navigation.spec.ts > color keys work');
    expect(color?.cells).toEqual({
      web: { status: 'passed' },
      tvos: { status: 'skipped', reason: 'requires key.color: not available on tvos' },
    });
    expect(readFileSync(join(first.dir, 'parity.md'), 'utf8')).toContain(
      '| navigation.spec.ts > fast forward | passed | passed [overrides: FAST_FORWARD = hold RIGHT 800ms] |',
    );
  });

  it('compares against the baselines written by the first run', { timeout: 150_000 }, () => {
    const second = playwright('main', ['specs/snapshots']);
    expect(second.status, second.output).toBe(0);
  });

  it('attaches a failure dump and explains the failure', { timeout: 150_000 }, () => {
    const failed = playwright('fail', ['--project=web'], { TOETS_SMOKE_MODE: 'fail' });
    expect(failed.status).toBe(1);
    const [t, thrown] = tests(failed.dir);
    expect(t?.result.status).toBe('failed');
    expect(t?.result.errors[0]?.message).toContain('expect(locator).toBeFocused() failed');
    expect(t?.result.errors[0]?.message).toContain('Focused:  card_1 "Movie 1"');
    const dump = t?.result.attachments.find((a) => a.name === 'toets-failure');
    expect(dump?.path).toMatch(/toets-failure[^/]*\.md$/);
    const text = readFileSync(dump?.path ?? '', 'utf8');
    expect(text).toContain('- last keys: RIGHT');
    expect(text).toContain('- card_1 "Movie 1" [focused]');
    expect(t?.result.attachments.map((a) => a.name)).toContain('toets-screenshot');

    const message = thrown?.result.errors[0]?.message ?? '';
    expect(message).toContain(
      "ToetsError: [ELEMENT_NOT_FOUND] getByTestId('no_such_element') matched no element",
    );
    expect(message).toContain('\nHint: Check the test ID');
    expect(message).toMatch(
      /\nDocs: reference\/core\/docs\/locators \(offline: \S*core\/docs\/locators\.md\)/,
    );
  });
});
