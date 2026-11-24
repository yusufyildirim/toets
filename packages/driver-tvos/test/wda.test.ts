import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundledWda, embedXctestFrameworks, ensurePrebuiltWda } from '../src/wda.js';
import { FakeRunner } from './helpers.js';

const XCODE = { stdout: 'Xcode 27.2\nBuild version 27B52\n' };
const PRODUCT = join(
  'Build',
  'Products',
  'Debug-appletvsimulator',
  'WebDriverAgentRunner_tvOS-Runner.app',
);

const RUNNER_BIN = 'WebDriverAgentRunner_tvOS-Runner';
const XCTEST_BIN = join('PlugIns', 'WebDriverAgentRunner_tvOS.xctest', 'WebDriverAgentRunner_tvOS');

/** `otool -L` output listing `@rpath` install names (own id first, like dylibs print it). */
const otool = (...names: string[]) => ({
  stdout: `bin:\n${names.map((n) => `\t@rpath/${n} (compatibility version 1.0.0)`).join('\n')}\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)\n`,
});

/**
 * A fake Xcode tvOS Simulator platform with XCTest's real dependency shape, and a runner that
 * answers `xcrun --show-sdk-platform-path` and `otool -L` for it.
 */
function fakePlatform(root: string, runner: FakeRunner): FakeRunner {
  const dev = join(root, 'AppleTVSimulator.platform', 'Developer');
  const lib = (dir: string, bundle: string) => {
    const path = join(dev, dir, bundle);
    if (bundle.endsWith('.dylib')) {
      mkdirSync(join(dev, dir), { recursive: true });
      writeFileSync(path, '');
    } else {
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, bundle.replace('.framework', '')), '');
    }
  };
  lib('Library/Frameworks', 'XCTest.framework');
  lib('Library/Frameworks', 'Testing.framework');
  lib('Library/Frameworks', '_Testing_Foundation.framework');
  // Unused overlays sharing a bundle identifier: must not be embedded.
  lib('Library/Frameworks', '_Testing_CoreGraphics.framework');
  lib('Library/Frameworks', '_Testing_CoreTransferable.framework');
  lib('Library/PrivateFrameworks', 'XCTestCore.framework');
  lib('usr/lib', 'libXCTestSwiftSupport.dylib');
  lib('usr/lib', 'lib_TestingInterop.dylib');
  return runner
    .on('--show-sdk-platform-path', { stdout: `${join(root, 'AppleTVSimulator.platform')}\n` })
    .on(`otool -L`, (args) => {
      const bin = args.at(-1)!;
      if (bin.endsWith(RUNNER_BIN)) return otool('XCTest.framework/XCTest');
      if (bin.endsWith(XCTEST_BIN))
        return otool(
          'XCTest.framework/XCTest',
          'libXCTestSwiftSupport.dylib',
          'WebDriverAgentLib_tvOS.framework/WebDriverAgentLib_tvOS',
        );
      if (bin.endsWith('XCTest.framework/XCTest'))
        return otool('XCTest.framework/XCTest', 'XCTestCore.framework/XCTestCore');
      if (bin.endsWith('XCTestCore'))
        return otool('XCTestCore.framework/XCTestCore', 'Testing.framework/Testing');
      if (bin.endsWith('libXCTestSwiftSupport.dylib'))
        return otool(
          'libXCTestSwiftSupport.dylib',
          'XCTest.framework/XCTest',
          '_Testing_Foundation.framework/_Testing_Foundation',
        );
      if (bin.endsWith('Testing.framework/Testing') || bin.endsWith('_Testing_Foundation'))
        return otool('Testing.framework/Testing', 'lib_TestingInterop.dylib');
      return otool();
    });
}

describe('embedXctestFrameworks', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'toets-wda-embed-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("copies the runner's transitive XCTest dependencies and re-signs it", async () => {
    const app = join(root, 'Runner.app');
    mkdirSync(join(app, 'PlugIns', 'WebDriverAgentRunner_tvOS.xctest'), { recursive: true });
    const runner = fakePlatform(root, new FakeRunner());
    await embedXctestFrameworks(app, runner);
    for (const bundle of [
      'XCTest.framework/XCTest',
      'XCTestCore.framework/XCTestCore',
      'Testing.framework/Testing',
      '_Testing_Foundation.framework/_Testing_Foundation',
      'libXCTestSwiftSupport.dylib',
      'lib_TestingInterop.dylib',
    ]) {
      expect(existsSync(join(app, 'Frameworks', bundle)), bundle).toBe(true);
    }
    expect(existsSync(join(app, 'Frameworks', '_Testing_CoreGraphics.framework'))).toBe(false);
    expect(existsSync(join(app, 'Frameworks', 'WebDriverAgentLib_tvOS.framework'))).toBe(false);
    expect(runner.lines().at(-1)).toBe(`codesign --force --sign - --timestamp=none ${app}`);
  });

  it('rejects a bundle that does not link XCTest', async () => {
    const runner = new FakeRunner()
      .on('--show-sdk-platform-path', { stdout: root })
      .on('otool -L', otool());
    await expect(embedXctestFrameworks(join(root, 'x.app'), runner)).rejects.toMatchObject({
      code: 'TVOS_WDA_BUILD_FAILED',
    });
  });
});

describe('ensurePrebuiltWda', () => {
  let cacheDir: string;
  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'toets-wda-'));
  });
  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  /** A runner whose `xcodebuild build-for-testing` creates the product in the derived data dir. */
  function buildingRunner(builds: { count: number }) {
    const runner = new FakeRunner()
      .on('xcodebuild -version', XCODE)
      .on('build-for-testing', (args) => {
        builds.count++;
        const derived = args[args.indexOf('-derivedDataPath') + 1]!;
        mkdirSync(join(derived, PRODUCT), { recursive: true });
        return { stdout: '** TEST BUILD SUCCEEDED **' };
      });
    return fakePlatform(join(cacheDir, 'xcode'), runner);
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
    expect(existsSync(join(a, 'Frameworks', 'XCTest.framework'))).toBe(true);
  });

  it('rebuilds a cache from before XCTest was embedded', async () => {
    const builds = { count: 0 };
    const dir = join(cacheDir, 'wda-custom-xcode-27B52');
    mkdirSync(join(dir, PRODUCT), { recursive: true });
    writeFileSync(join(dir, '.toets-complete'), '');
    const path = await ensurePrebuiltWda({
      cacheDir,
      runner: buildingRunner(builds),
      projectDir: '/wda',
    });
    expect(builds.count).toBe(1);
    expect(existsSync(join(path, 'Frameworks', 'XCTest.framework'))).toBe(true);
  });

  it('fails with the build log location and releases the lock', async () => {
    const runner = new FakeRunner().on('xcodebuild -version', XCODE).on('build-for-testing', {
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
