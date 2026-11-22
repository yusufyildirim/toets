import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { defaultRunner, tail, type CommandRunner } from './command.js';
import { DOCS, TvosErrorCode, tvosError } from './errors.js';

export interface PrebuiltWdaOptions {
  /** Where built WebDriverAgent bundles are cached. Default `~/Library/Caches/dpad/tvos-wda`. */
  readonly cacheDir?: string;
  /** Default 900000 (15 minutes). */
  readonly buildTimeoutMs?: number;
  readonly runner?: CommandRunner;
  readonly log?: (message: string) => void;
  /** WebDriverAgent sources. Default: the copy bundled with the pinned XCUITest driver. */
  readonly projectDir?: string;
}

const PRODUCT = join(
  'Build',
  'Products',
  'Debug-appletvsimulator',
  'WebDriverAgentRunner_tvOS-Runner.app',
);
const MARKER = '.dpad-complete';
const POLL_MS = 1000;

export function defaultWdaCacheDir(): string {
  return join(homedir(), 'Library', 'Caches', 'dpad', 'tvos-wda');
}

/** WebDriverAgent sources bundled with the pinned XCUITest driver, and their version. */
export function bundledWda(): { readonly dir: string; readonly version: string } {
  const require = createRequire(import.meta.url);
  const fromDriver = createRequire(require.resolve('appium-xcuitest-driver/package.json'));
  const pkgPath = fromDriver.resolve('appium-webdriveragent/package.json');
  const { version } = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return { dir: dirname(pkgPath), version };
}

/**
 * Builds WebDriverAgent for the generic tvOS Simulator destination once per WDA version and
 * Xcode build, and returns the runner `.app`. Sessions install this bundle instead of running
 * `xcodebuild test` per session: faster, and it works for simulators in custom device sets,
 * which `xcodebuild -destination id=` cannot see. Parallel workers share one build through a
 * lock directory.
 */
export async function ensurePrebuiltWda(opts: PrebuiltWdaOptions = {}): Promise<string> {
  const runner = opts.runner ?? defaultRunner;
  const log = opts.log ?? (() => {});
  const buildTimeoutMs = opts.buildTimeoutMs ?? 900_000;
  const wda = opts.projectDir ? { dir: opts.projectDir, version: 'custom' } : bundledWda();
  const xcode = await xcodeBuildVersion(runner);
  const dir = join(opts.cacheDir ?? defaultWdaCacheDir(), `wda-${wda.version}-xcode-${xcode}`);
  const app = join(dir, PRODUCT);
  const lock = `${dir}.lock`;
  const done = () => existsSync(join(dir, MARKER)) && existsSync(app);

  await mkdir(dirname(dir), { recursive: true });
  for (;;) {
    if (done()) return app;
    if (await tryLock(lock, buildTimeoutMs)) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  try {
    if (done()) return app;
    log(`Building WebDriverAgent ${wda.version} for tvOS Simulator (one time, cached in ${dir})`);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const res = await runner.run(
      'xcodebuild',
      [
        'build-for-testing',
        '-project',
        join(wda.dir, 'WebDriverAgent.xcodeproj'),
        '-scheme',
        'WebDriverAgentRunner_tvOS',
        '-destination',
        'generic/platform=tvOS Simulator',
        '-derivedDataPath',
        dir,
        'CODE_SIGNING_ALLOWED=NO',
        'COMPILER_INDEX_STORE_ENABLE=NO',
        'GCC_TREAT_WARNINGS_AS_ERRORS=0',
      ],
      { timeoutMs: buildTimeoutMs },
    );
    await writeFile(join(dir, 'build.log'), `${res.stdout}\n${res.stderr}`);
    if (res.exitCode !== 0 || !existsSync(app)) {
      throw tvosError(
        TvosErrorCode.WDA_BUILD_FAILED,
        `Building WebDriverAgent for tvOS Simulator failed (exit ${res.exitCode}):\n${tail(res.stderr || res.stdout)}`,
        {
          hint: `Full log: ${join(dir, 'build.log')}. Check that Xcode with the tvOS platform is installed (\`xcodebuild -downloadPlatform tvOS\`).`,
          docs: DOCS.setup,
        },
      );
    }
    await writeFile(join(dir, MARKER), new Date().toISOString());
    return app;
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

/** `Build version 27B52` -> `27B52`. */
export async function xcodeBuildVersion(runner: CommandRunner): Promise<string> {
  const res = await runner.run('xcodebuild', ['-version']);
  const build = /Build version\s+(\S+)/.exec(res.stdout)?.[1];
  if (res.exitCode !== 0 || !build) {
    throw tvosError(TvosErrorCode.WDA_BUILD_FAILED, 'Could not read the Xcode version.', {
      hint: 'Install Xcode and select it with `sudo xcode-select -s /Applications/Xcode.app`.',
      docs: DOCS.setup,
    });
  }
  return build;
}

/** Takes the lock directory; breaks a lock older than the build timeout (crashed builder). */
async function tryLock(lock: string, staleAfterMs: number): Promise<boolean> {
  try {
    await mkdir(lock);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    const age = await stat(lock).then(
      (s) => Date.now() - s.mtimeMs,
      () => 0,
    );
    if (age > staleAfterMs) await rm(lock, { recursive: true, force: true });
    return false;
  }
}
