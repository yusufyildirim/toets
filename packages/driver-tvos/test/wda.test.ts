import { existsSync, mkdirSync } from 'node:fs';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundledWda, ensurePrebuiltWda } from '../src/wda.js';
import { FakeRunner } from './helpers.js';

const XCODE = { stdout: 'Xcode 27.2\nBuild version 27B52\n' };
const PRODUCT = join(
  'Build',
  'Products',
  'Debug-appletvsimulator',
  'WebDriverAgentRunner_tvOS-Runner.app',
);

describe('ensurePrebuiltWda', () => {
  let cacheDir: string;
  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'dpad-wda-'));
  });
  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  /** A runner whose `xcodebuild build-for-testing` creates the product in the derived data dir. */
  function buildingRunner(builds: { count: number }) {
    return new FakeRunner().on('xcodebuild -version', XCODE).on('build-for-testing', (args) => {
      builds.count++;
      const derived = args[args.indexOf('-derivedDataPath') + 1]!;
      mkdirSync(join(derived, PRODUCT), { recursive: true });
      return { stdout: '** TEST BUILD SUCCEEDED **' };
    });
  }

  it('builds once per WDA and Xcode version for the generic tvOS Simulator', async () => {
    const builds = { count: 0 };
    const runner = buildingRunner(builds);
    const [a, b] = await Promise.all([
      ensurePrebuiltWda({ cacheDir, runner }),
      ensurePrebuiltWda({ cacheDir, runner }),
    ]);
    const again = await ensurePrebuiltWda({ cacheDir, runner });
    expect(builds.count).toBe(1);
    expect(a).toBe(b);
    expect(again).toBe(a);
    expect(a).toBe(join(cacheDir, `wda-${bundledWda().version}-xcode-27B52`, PRODUCT));
    const build = runner.calls.find((c) => c.args.includes('build-for-testing'))!;
    expect(build.args).toEqual(
      expect.arrayContaining([
        '-scheme',
        'WebDriverAgentRunner_tvOS',
        '-destination',
        'generic/platform=tvOS Simulator',
        'CODE_SIGNING_ALLOWED=NO',
      ]),
    );
    expect(build.args[build.args.indexOf('-project') + 1]).toBe(
      join(bundledWda().dir, 'WebDriverAgent.xcodeproj'),
    );
    expect(existsSync(`${join(cacheDir, `wda-${bundledWda().version}-xcode-27B52`)}.lock`)).toBe(
      false,
    );
  });

  it('fails with the build log location and releases the lock', async () => {
    const runner = new FakeRunner()
      .on('xcodebuild -version', XCODE)
      .on('build-for-testing', {
        exitCode: 65,
        stderr: 'error: SDK "appletvsimulator" cannot be located',
      });
    await expect(ensurePrebuiltWda({ cacheDir, runner, projectDir: '/wda' })).rejects.toMatchObject(
      {
        code: 'TVOS_WDA_BUILD_FAILED',
        message: expect.stringContaining('cannot be located'),
        hint: expect.stringContaining('build.log'),
      },
    );
    expect(existsSync(join(cacheDir, 'wda-custom-xcode-27B52.lock'))).toBe(false);
  });

  it('breaks a stale lock left by a crashed build', async () => {
    const builds = { count: 0 };
    const lock = join(cacheDir, 'wda-custom-xcode-27B52.lock');
    await mkdir(lock, { recursive: true });
    await writeFile(join(lock, 'x'), '');
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);
    const path = await ensurePrebuiltWda({
      cacheDir,
      runner: buildingRunner(builds),
      projectDir: '/wda',
      buildTimeoutMs: 1000,
    });
    expect(builds.count).toBe(1);
    expect(path.endsWith(PRODUCT)).toBe(true);
  });

  it('requires a readable Xcode version', async () => {
    const runner = new FakeRunner().on('xcodebuild -version', {
      exitCode: 1,
      stderr: 'xcode-select: error',
    });
    await expect(ensurePrebuiltWda({ cacheDir, runner })).rejects.toMatchObject({
      code: 'TVOS_WDA_BUILD_FAILED',
    });
  });
});
