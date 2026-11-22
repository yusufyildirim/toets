import {
  formatCommand,
  shellQuote,
  type CommandResult,
  type CommandRunner,
  type RunOptions,
  type SpawnOptions,
  type SpawnedProcess,
} from './command.js';
import { DOCS, androidError } from './errors.js';

/** An activity to start, with the intent action/category the launcher would use. */
export interface LaunchTarget {
  /** `package/.Activity` or `package/full.class.Name`. */
  readonly component: string;
  readonly action?: string;
  readonly category?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * `adb` bound to one device serial. Thin and explicit: one method per device operation the
 * driver needs, each failing with a `DpadError` that names the command and its output.
 */
export class Adb {
  constructor(
    readonly runner: CommandRunner,
    readonly adbPath: string,
    readonly serial: string,
    readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  /** Runs `adb -s <serial> ...args` and returns the raw result. */
  run(args: readonly string[], opts: Omit<RunOptions, 'env'> = {}): Promise<CommandResult> {
    return this.runner.run(this.adbPath, ['-s', this.serial, ...args], { ...opts, env: this.env });
  }

  /** Runs `adb -s <serial> ...args`, throws on a non-zero exit, returns stdout. */
  async exec(args: readonly string[], opts: Omit<RunOptions, 'env'> = {}): Promise<string> {
    const res = await this.run(args, opts);
    if (res.exitCode !== 0) {
      throw androidError(
        'ANDROID_COMMAND_FAILED',
        `\`${formatCommand('adb', ['-s', this.serial, ...args])}\` failed (exit ${res.exitCode}): ${(res.stderr || res.stdout).trim()}`,
        { hint: `Check that ${this.serial} is online (\`adb devices\`).`, docs: DOCS.devices },
      );
    }
    return res.stdout;
  }

  /** Runs a command in the device shell; each argument is quoted for `sh`. */
  shell(command: readonly string[], opts: Omit<RunOptions, 'env'> = {}): Promise<string> {
    return this.exec(['shell', command.map(shellQuote).join(' ')], opts);
  }

  /** Starts a long-running `adb -s <serial> ...args` process. */
  spawn(args: readonly string[], opts: Omit<SpawnOptions, 'env'> = {}): SpawnedProcess {
    return this.runner.spawn(this.adbPath, ['-s', this.serial, ...args], { ...opts, env: this.env });
  }

  async getProp(name: string): Promise<string> {
    return (await this.shell(['getprop', name])).trim();
  }

  async sdkVersion(): Promise<number> {
    return Number(await this.getProp('ro.build.version.sdk'));
  }

  /** Waits until the device is online and Android finished booting. */
  async waitForBoot(timeoutMs: number, pollMs = 1000, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let last = 'offline';
    while (Date.now() < deadline && !signal?.aborted) {
      const state = await this.run(['get-state'], { timeoutMs: 10_000 }).catch(() => null);
      if (state?.exitCode === 0 && state.stdout.trim() === 'device') {
        last = 'booting';
        const booted = await this.run(['shell', 'getprop sys.boot_completed'], {
          timeoutMs: 10_000,
        }).catch(() => null);
        if (booted?.exitCode === 0 && booted.stdout.trim() === '1') return;
      }
      await sleep(pollMs);
    }
    throw androidError(
      'ANDROID_DEVICE_NOT_READY',
      `${this.serial} did not finish booting within ${timeoutMs}ms (last state: ${last}).`,
      {
        hint: 'Check the device with `adb devices`; cold boots of TV images can take minutes.',
        docs: DOCS.devices,
      },
    );
  }

  async install(apkPath: string): Promise<void> {
    const out = await this.exec(['install', '-r', '-t', '-g', apkPath], { timeoutMs: 300_000 });
    if (!/Success/.test(out)) {
      throw androidError('ANDROID_COMMAND_FAILED', `Installing ${apkPath} failed: ${out.trim()}`, {
        hint: 'Check that the APK is built for this device ABI and API level.',
        docs: DOCS.setup,
      });
    }
  }

  async isInstalled(pkg: string): Promise<boolean> {
    const res = await this.run(['shell', `pm path ${shellQuote(pkg)}`]);
    return res.exitCode === 0 && res.stdout.includes('package:');
  }

  /** The Linux uid of a package (used to attribute log lines to the app). */
  async appUid(pkg: string): Promise<number | null> {
    const out = await this.shell(['pm', 'list', 'packages', '-U', pkg]).catch(() => '');
    for (const line of out.split('\n')) {
      const m = /^package:(\S+) uid:(\d+)/.exec(line.trim());
      if (m && m[1] === pkg) return Number(m[2]);
    }
    return null;
  }

  /** The activity a TV launcher (then a phone launcher) would start for `pkg`. */
  async resolveLauncher(pkg: string): Promise<LaunchTarget | null> {
    for (const category of [
      'android.intent.category.LEANBACK_LAUNCHER',
      'android.intent.category.LAUNCHER',
    ]) {
      const out = await this.shell([
        'cmd',
        'package',
        'resolve-activity',
        '--brief',
        '-a',
        'android.intent.action.MAIN',
        '-c',
        category,
        pkg,
      ]).catch(() => '');
      const component = out
        .trim()
        .split('\n')
        .map((l) => l.trim())
        .reverse()
        .find((l) => l.startsWith(`${pkg}/`));
      if (component) return { component, action: 'android.intent.action.MAIN', category };
    }
    return null;
  }

  async forceStop(pkg: string): Promise<void> {
    await this.shell(['am', 'force-stop', pkg]);
  }

  async clearData(pkg: string): Promise<void> {
    const out = await this.shell(['pm', 'clear', pkg]);
    if (!out.includes('Success')) {
      throw androidError('ANDROID_COMMAND_FAILED', `\`pm clear ${pkg}\` failed: ${out.trim()}`, {
        hint: 'Check that the package is installed on the device.',
      });
    }
  }

  /**
   * Starts an activity with string extras and waits until it is drawn (`am start -W`). `am`
   * exits 0 even when it fails, so its output is checked.
   */
  async startActivity(
    target: LaunchTarget,
    extras: Readonly<Record<string, string>> = {},
  ): Promise<void> {
    const args = ['am', 'start', '-W', '-n', target.component];
    if (target.action) args.push('-a', target.action);
    if (target.category) args.push('-c', target.category);
    for (const [k, v] of Object.entries(extras)) args.push('--es', k, v);
    const out = await this.shell(args, { timeoutMs: 120_000 });
    const error = out.split('\n').find((l) => /^(Error|Exception|Warning: Activity not started)/.test(l.trim()));
    if (error || !/Status: ok|Complete/.test(out)) {
      throw androidError(
        'ANDROID_LAUNCH_FAILED',
        `Launching ${target.component} failed: ${(error ?? out).trim()}`,
        {
          hint: 'Check `app.package` / `app.activity` and that the activity is exported.',
          docs: DOCS.setup,
        },
      );
    }
  }

  /** Makes `localhost:<port>` on the device reach `localhost:<port>` on the host. */
  async reverse(port: number): Promise<void> {
    await this.exec(['reverse', `tcp:${port}`, `tcp:${port}`]);
  }

  async removeReverse(port: number): Promise<void> {
    await this.run(['reverse', '--remove', `tcp:${port}`]);
  }

  async push(local: string, remote: string): Promise<void> {
    await this.exec(['push', local, remote], { timeoutMs: 120_000 });
  }

  async pull(remote: string, local: string): Promise<void> {
    await this.exec(['pull', remote, local], { timeoutMs: 300_000 });
  }

  /** Sends an emulator console command (`adb emu ...`). Emulators only. */
  async emu(args: readonly string[], timeoutMs = 120_000): Promise<string> {
    const out = await this.exec(['emu', ...args], { timeoutMs });
    if (/^KO/m.test(out)) {
      throw androidError(
        'ANDROID_COMMAND_FAILED',
        `Emulator console \`${args.join(' ')}\` failed: ${out.trim()}`,
      );
    }
    return out;
  }
}
