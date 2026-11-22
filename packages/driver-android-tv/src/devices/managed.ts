import type {
  DeviceAcquireOptions,
  DeviceLease,
  DeviceProvider,
  DeviceSpec,
} from '@dpad-tv/core';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { arch, homedir } from 'node:os';
import { join } from 'node:path';
import { Adb } from '../adb.js';
import { nodeCommandRunner, type CommandRunner, type SpawnedProcess } from '../command.js';
import { DOCS, androidError } from '../errors.js';
import { resolveAndroidSdk, type AndroidSdk } from '../sdk.js';
import { withFileLock } from './lock.js';

/** Settings of the `managed` device provider (`platforms.androidTV({ managed: { ... } })`). */
export interface ManagedDeviceOptions {
  /** System image tag. Default `android-tv` (`google-tv` images work too). */
  readonly imageTag?: 'android-tv' | 'google-tv';
  /** Image ABI. Default: `arm64-v8a` on arm64 hosts, `x86_64` otherwise. */
  readonly abi?: string;
  /** Run emulators without a window. Default `true`. */
  readonly headless?: boolean;
  /**
   * Leave emulators running after the run and adopt them in the next one (restored to the
   * clean snapshot), which skips the boot entirely. Default `false`.
   */
  readonly reuse?: boolean;
  /** Boot timeout per emulator. Default 300 000 ms. */
  readonly bootTimeoutMs?: number;
  /** First emulator console port; worker `n` starts searching at `basePort + 2n`. Default 5554. */
  readonly basePort?: number;
  /** Extra `emulator` arguments, e.g. `['-gpu', 'swiftshader_indirect']` on CI. */
  readonly emulatorArgs?: readonly string[];
  /** AVD directory. Default: `ANDROID_AVD_HOME`, then `~/.android/avd`. */
  readonly avdHome?: string;
}

/** Name of the snapshot every managed emulator boots from and is reset to. */
export const CLEAN_SNAPSHOT = 'dpad_clean';

const DEFAULT_MODEL = 'tv_1080p';
const MAX_PORT = 5682;

/** Seams for unit tests. */
export interface ManagedDeviceDeps {
  readonly runner?: CommandRunner;
  readonly env?: NodeJS.ProcessEnv;
  readonly isPortFree?: (port: number) => Promise<boolean>;
  readonly log?: (message: string) => void;
  /** Pause between boot and saving the clean snapshot. Default 10 000 ms. */
  readonly settleMs?: number;
}

interface ManagedDevice {
  readonly avd: string;
  readonly serial: string;
  readonly port: number;
  /** Set when this provider booted it (vs adopted a running one). */
  readonly proc: SpawnedProcess | undefined;
  leased: boolean;
}

/**
 * Creates, boots, snapshots, resets and tears down Android TV emulators, one per worker.
 *
 * - The AVD (`dpad_<model>_api<level>_<tag>`) is created from an installed system image.
 * - On first use it is cold-booted once and saved as the `dpad_clean` snapshot.
 * - Workers boot `-read-only` instances from that snapshot (several can run at once and none
 *   can modify it); a reset is a snapshot load, which takes seconds.
 */
export class ManagedDeviceProvider implements DeviceProvider {
  private readonly runner: CommandRunner;
  private readonly env: NodeJS.ProcessEnv;
  private readonly devices: ManagedDevice[] = [];
  private sdkCache: AndroidSdk | undefined;

  constructor(
    private readonly options: ManagedDeviceOptions = {},
    private readonly sdkRoot?: string,
    private readonly deps: ManagedDeviceDeps = {},
  ) {
    this.runner = deps.runner ?? nodeCommandRunner;
    this.env = deps.env ?? process.env;
  }

  async acquire(spec: DeviceSpec, opts: DeviceAcquireOptions): Promise<DeviceLease> {
    const image = this.resolveImage(spec);
    const avd = avdName(image.model, image.api, image.tag);

    const idle = this.devices.find((d) => d.avd === avd && !d.leased);
    if (idle) {
      await this.reset(idle.serial);
      return this.lease(idle, image.api);
    }

    await this.ensureCleanSnapshot(avd, image);
    const device = await this.bootOrAdopt(avd, opts.parallelIndex);
    return this.lease(device, image.api);
  }

  /** Restores a managed emulator to the clean snapshot (fast device reset). */
  async reset(serial: string): Promise<void> {
    const adb = this.adb(serial);
    await adb.emu(['avd', 'snapshot', 'load', CLEAN_SNAPSHOT]);
    await adb.waitForBoot(this.options.bootTimeoutMs ?? 300_000);
  }

  async dispose(): Promise<void> {
    const devices = this.devices.splice(0);
    if (this.options.reuse) return;
    await Promise.all(
      devices.map(async (d) => {
        await this.adb(d.serial)
          .run(['emu', 'kill'], { timeoutMs: 30_000 })
          .catch(() => null);
        if (d.proc) {
          const exited = await Promise.race([
            d.proc.exited.then(() => true),
            new Promise<false>((r) => setTimeout(() => r(false), 30_000)),
          ]);
          if (!exited) d.proc.kill('SIGKILL');
        }
      }),
    );
  }

  private lease(device: ManagedDevice, api: string): DeviceLease {
    device.leased = true;
    let released = false;
    return {
      id: `${device.avd}@${device.serial}`,
      platform: 'android-tv',
      address: device.serial,
      meta: { avd: device.avd, port: device.port, api, snapshot: CLEAN_SNAPSHOT },
      release: async () => {
        if (released) return;
        released = true;
        device.leased = false;
      },
    };
  }

  private get sdk(): AndroidSdk {
    this.sdkCache ??= resolveAndroidSdk(this.sdkRoot, this.env);
    return this.sdkCache;
  }

  private adb(serial: string): Adb {
    return new Adb(this.runner, this.sdk.adb, serial, this.env);
  }

  private get avdHome(): string {
    return (
      this.options.avdHome ??
      this.env.ANDROID_AVD_HOME ??
      join(this.env.ANDROID_USER_HOME ?? join(homedir(), '.android'), 'avd')
    );
  }

  /** Picks the system image from the spec (`osVersion` = API level, `model` = device profile). */
  resolveImage(spec: DeviceSpec): {
    api: string;
    tag: string;
    abi: string;
    model: string;
    pkg: string;
  } {
    const tag = this.options.imageTag ?? 'android-tv';
    const abi = this.options.abi ?? (arch() === 'arm64' ? 'arm64-v8a' : 'x86_64');
    const model = spec.model ?? DEFAULT_MODEL;
    const imagesDir = join(this.sdk.root, 'system-images');
    const installed = existsSync(imagesDir)
      ? readdirSync(imagesDir)
          .filter((d) => existsSync(join(imagesDir, d, tag, abi)))
          .map((d) => d.replace(/^android-/, ''))
      : [];
    const api =
      spec.osVersion ?? installed.sort((a, b) => Number.parseFloat(b) - Number.parseFloat(a))[0];
    const pkg = `system-images;android-${api ?? '<api>'};${tag};${abi}`;
    if (!api || !installed.includes(api)) {
      throw androidError(
        'ANDROID_SYSTEM_IMAGE_MISSING',
        `No ${tag} system image for API ${api ?? '(any)'} (${abi}) is installed.`,
        {
          hint: `Install it with \`sdkmanager "${pkg}"\`. Installed ${tag} images: ${installed.join(', ') || 'none'}.`,
          docs: DOCS.devices,
        },
      );
    }
    return { api, tag, abi, model, pkg };
  }

  private async ensureCleanSnapshot(
    avd: string,
    image: { pkg: string; model: string },
  ): Promise<void> {
    const avdDir = join(this.avdHome, `${avd}.avd`);
    const snapshotDir = join(avdDir, 'snapshots', CLEAN_SNAPSHOT);
    if (existsSync(snapshotDir)) return;
    await mkdir(this.avdHome, { recursive: true });
    await withFileLock(join(this.avdHome, `${avd}.dpad-lock`), async () => {
      if (!existsSync(join(this.avdHome, `${avd}.ini`))) await this.createAvd(avd, image);
      if (existsSync(snapshotDir)) return;
      this.deps.log?.(
        `android-tv: cold-booting ${avd} once to create the ${CLEAN_SNAPSHOT} snapshot`,
      );
      const port = await this.findPort(0);
      const proc = this.spawnEmulator(avd, port, ['-no-snapshot-load']);
      const adb = this.adb(`emulator-${port}`);
      try {
        await this.waitForBootOrExit(adb, proc, avd);
        // Let the launcher and boot-time jobs settle so the snapshot starts quiet.
        await new Promise((r) => setTimeout(r, this.deps.settleMs ?? 10_000));
        await adb.emu(['avd', 'snapshot', 'save', CLEAN_SNAPSHOT]);
      } finally {
        await adb.run(['emu', 'kill'], { timeoutMs: 30_000 }).catch(() => null);
        await Promise.race([proc.exited, new Promise((r) => setTimeout(r, 30_000))]);
        proc.kill('SIGKILL');
      }
    });
  }

  private async createAvd(avd: string, image: { pkg: string; model: string }): Promise<void> {
    const res = await this.runner.run(
      this.sdk.avdmanager,
      ['create', 'avd', '--name', avd, '--package', image.pkg, '--device', image.model, '--force'],
      // avdmanager asks whether to create a custom hardware profile.
      { input: 'no\n', env: this.env, timeoutMs: 120_000 },
    );
    if (res.exitCode !== 0) {
      throw androidError(
        'ANDROID_AVD_FAILED',
        `Creating AVD ${avd} failed: ${(res.stderr || res.stdout).trim()}`,
        {
          hint: `Check that the device profile '${image.model}' exists (\`avdmanager list device\`) and cmdline-tools are installed.`,
          docs: DOCS.devices,
        },
      );
    }
  }

  private async bootOrAdopt(avd: string, slot: number): Promise<ManagedDevice> {
    if (this.options.reuse) {
      const adopted = await this.adoptRunning(avd);
      if (adopted) return adopted;
    }
    const port = await this.findPort(slot);
    const proc = this.spawnEmulator(avd, port, [
      '-read-only',
      '-snapshot',
      CLEAN_SNAPSHOT,
      '-no-snapshot-save',
    ]);
    const device: ManagedDevice = { avd, serial: `emulator-${port}`, port, proc, leased: false };
    this.devices.push(device);
    await this.waitForBootOrExit(this.adb(device.serial), proc, avd);
    return device;
  }

  /** A running emulator of this AVD from a previous run that nobody here holds. */
  private async adoptRunning(avd: string): Promise<ManagedDevice | null> {
    for (const serial of await this.runningEmulators()) {
      if (this.devices.some((d) => d.serial === serial)) continue;
      const name = await this.adb(serial)
        .emu(['avd', 'name'], 10_000)
        .catch(() => '');
      if (name.split(/\r?\n/)[0]?.trim() !== avd) continue;
      const port = Number(serial.slice('emulator-'.length));
      const device: ManagedDevice = { avd, serial, port, proc: undefined, leased: false };
      this.devices.push(device);
      await this.reset(serial);
      return device;
    }
    return null;
  }

  private async runningEmulators(): Promise<string[]> {
    const res = await this.runner.run(this.sdk.adb, ['devices'], { env: this.env });
    return res.stdout
      .split('\n')
      .map((l) => l.trim().split(/\s+/))
      .filter(([serial, state]) => serial?.startsWith('emulator-') && state === 'device')
      .map(([serial]) => serial!);
  }

  private async findPort(slot: number): Promise<number> {
    const base = this.options.basePort ?? 5554;
    const taken = new Set([
      ...(await this.runningEmulators()),
      ...this.devices.map((d) => d.serial),
    ]);
    const isFree = this.deps.isPortFree ?? isPortFree;
    for (let port = base + 2 * slot; port <= MAX_PORT; port += 2) {
      if (taken.has(`emulator-${port}`)) continue;
      if ((await isFree(port)) && (await isFree(port + 1))) return port;
    }
    throw androidError(
      'ANDROID_EMULATOR_FAILED',
      `No free emulator port from ${base} to ${MAX_PORT}.`,
      {
        hint: 'Too many emulators are running. Stop unused ones or lower the worker count.',
        docs: DOCS.devices,
      },
    );
  }

  private spawnEmulator(avd: string, port: number, extra: readonly string[]): SpawnedProcess {
    const args = [
      '-avd',
      avd,
      '-port',
      String(port),
      '-no-boot-anim',
      '-no-audio',
      ...(this.options.headless === false ? [] : ['-no-window']),
      ...extra,
      ...(this.options.emulatorArgs ?? []),
    ];
    this.deps.log?.(`android-tv: starting emulator ${avd} on port ${port}`);
    return this.runner.spawn(this.sdk.emulator, args, {
      env: this.env,
      detached: this.options.reuse ?? false,
      logFile: join(this.avdHome, `${avd}.avd`, `dpad-emulator-${port}.log`),
    });
  }

  private async waitForBootOrExit(adb: Adb, proc: SpawnedProcess, avd: string): Promise<void> {
    const timeoutMs = this.options.bootTimeoutMs ?? 300_000;
    const abort = new AbortController();
    const exit = proc.exited.then((code) => {
      throw androidError(
        'ANDROID_EMULATOR_FAILED',
        `Emulator ${avd} exited (code ${code}) while booting.`,
        {
          hint: `See ${join(this.avdHome, `${avd}.avd`)}/dpad-emulator-*.log. On Linux, check KVM access.`,
          docs: DOCS.devices,
        },
      );
    });
    try {
      await Promise.race([adb.waitForBoot(timeoutMs, 1000, abort.signal), exit]);
    } finally {
      abort.abort();
    }
  }
}

/** AVD name for an image: `dpad_tv_1080p_api33_android-tv`. */
export function avdName(model: string, api: string, tag: string): string {
  return `dpad_${model}_api${api}_${tag}`.replace(/[^\w.-]/g, '_');
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}
