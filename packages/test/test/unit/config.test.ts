import { Key } from '@dpad-tv/core';
import { describe, expect, it } from 'vitest';
import { defineConfig, platforms, type DpadProjectConfig } from '../../src/config.js';
import { requiredCapabilities, requires, requiresSkipReason } from '../../src/requires.js';
import { serialGroupOf } from '../../src/serial.js';

const dpadOf = (project: { use?: unknown } | undefined) =>
  (project?.use as { dpad: DpadProjectConfig }).dpad;

describe('platforms', () => {
  it('builds a project named after the platform with the default driver', () => {
    const project = platforms.androidTV({ retries: 1, use: { trace: 'on' } });
    expect(project.name).toBe('android-tv');
    expect(project.retries).toBe(1);
    expect(project.use).toMatchObject({ trace: 'on' });
    expect(dpadOf(project)).toEqual({
      platform: 'android-tv',
      driver: '@dpad-tv/driver-android-tv',
      driverOptions: {},
      app: {},
      device: {},
      devices: undefined,
      options: {},
    });
  });

  it('keeps project overrides', () => {
    const project = platforms.tvOS({
      name: 'apple-tv-4k',
      driver: './my-driver.js',
      model: 'Apple TV 4K',
      osVersion: '18',
      devices: { mode: 'external', addresses: ['UDID-1'] },
    });
    expect(project.name).toBe('apple-tv-4k');
    expect(dpadOf(project)).toMatchObject({
      platform: 'tvos',
      driver: './my-driver.js',
      device: { model: 'Apple TV 4K', osVersion: '18' },
      devices: { mode: 'external', addresses: ['UDID-1'] },
    });
  });

  it('passes every key that is neither Playwright nor dpad to the driver', () => {
    const project = platforms.androidTV({
      name: 'fire-tv',
      retries: 2,
      timeout: 60_000,
      model: 'tv_1080p',
      remote: 'fire-tv',
      logcat: 'all',
      managed: { headless: false },
      app: { activity: '.Main' },
      dpad: { sdk: true },
    });
    expect(project).toMatchObject({ name: 'fire-tv', retries: 2, timeout: 60_000 });
    expect(project).not.toHaveProperty('remote');
    expect(dpadOf(project)).toMatchObject({
      driverOptions: { remote: 'fire-tv', logcat: 'all', managed: { headless: false } },
      device: { model: 'tv_1080p' },
      app: { activity: '.Main' },
      options: { sdk: true },
    });
    expect(Object.keys(dpadOf(project).driverOptions)).toEqual(['remote', 'logcat', 'managed']);
  });

  it('types a custom driver through its options type', () => {
    interface MyOptions {
      readonly speed: number;
    }
    const project = platforms.web<MyOptions>({ driver: './my-driver.js', speed: 2 });
    expect(dpadOf(project).driverOptions).toEqual({ speed: 2 });
    // @ts-expect-error unknown driver option
    platforms.web({ notAnOption: true });
  });
});

describe('defineConfig', () => {
  it('merges per-platform app entries and shared options into projects', () => {
    const config = defineConfig({
      app: { web: { url: 'http://localhost:3000' }, tvOS: { bundleId: 'com.example.tv' } },
      dpad: {
        sdk: true,
        keyOverrides: { FAST_FORWARD: { as: Key.RIGHT, holdMs: 800 } },
        timeouts: { actionMs: 3000 },
      },
      projects: [
        platforms.web({ app: { url: 'http://localhost:4000' } }),
        platforms.tvOS({ dpad: { timeouts: { sdkConnectMs: 30_000 }, sdk: false } }),
        { name: 'plain' },
      ],
    });
    const [web, tvos, plain] = config.projects ?? [];
    expect(dpadOf(web).app).toEqual({ url: 'http://localhost:4000' });
    expect(dpadOf(web).options.sdk).toBe(true);
    expect(dpadOf(tvos).app).toEqual({ bundleId: 'com.example.tv' });
    expect(dpadOf(tvos).options).toMatchObject({
      sdk: false,
      keyOverrides: { FAST_FORWARD: { as: Key.RIGHT, holdMs: 800 } },
      timeouts: { actionMs: 3000, sdkConnectMs: 30_000 },
    });
    expect(plain).toEqual({ name: 'plain' });
  });

  it('defaults dpad projects to host-independent snapshot paths', () => {
    const template =
      '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-projectName}{ext}';
    const [web, plain] = defineConfig({ projects: [platforms.web(), { name: 'plain' }] }).projects!;
    expect(web?.snapshotPathTemplate).toBe(template);
    expect(web?.snapshotPathTemplate).not.toContain('snapshotSuffix');
    expect(plain?.snapshotPathTemplate).toBeUndefined();
  });

  it('keeps a configured snapshot path template, the project one first', () => {
    const [web, tvos] = defineConfig({
      snapshotPathTemplate: '{testDir}/__snapshots__/{arg}{ext}',
      projects: [platforms.web(), platforms.tvOS({ snapshotPathTemplate: '{arg}-tv{ext}' })],
    }).projects!;
    expect(web?.snapshotPathTemplate).toBe('{testDir}/__snapshots__/{arg}{ext}');
    expect(tvos?.snapshotPathTemplate).toBe('{arg}-tv{ext}');
  });

  it('appends the parity reporter after the configured reporters', () => {
    const config = defineConfig({ reporter: [['html', { open: 'never' }]] });
    const reporters = config.reporter as [string, unknown][];
    expect(reporters[0]).toEqual(['html', { open: 'never' }]);
    expect(reporters[1]?.[0]).toMatch(/reporter\.(ts|js)$/);
    expect(reporters[1]?.[1]).toEqual({});
  });

  it('adds a default console reporter when none is configured', () => {
    const reporters = defineConfig({ parityReport: { summary: false } }).reporter as [
      string,
      unknown,
    ][];
    expect(reporters).toHaveLength(2);
    expect(['list', 'dot']).toContain(reporters[0]?.[0]);
    expect(reporters[1]?.[1]).toEqual({ summary: false });
  });

  it('leaves reporters alone when the parity report is off', () => {
    expect(defineConfig({ parityReport: false }).reporter).toBeUndefined();
    expect(defineConfig({ parityReport: false, reporter: 'dot' }).reporter).toBe('dot');
  });
});

describe('requires', () => {
  it('is an annotation the fixture reads back', () => {
    const details = requires('key.color', 'media.state');
    expect(details).toEqual({
      annotation: { type: 'requires', description: 'key.color, media.state' },
    });
    expect(
      requiredCapabilities([
        { type: 'requires', description: 'key.color, media.state' },
        { type: 'requires', description: 'media.state' },
        { type: 'skip' },
      ]),
    ).toEqual(['key.color', 'media.state']);
  });

  it('names the dpad option a skipped capability needs', () => {
    const on = { sdk: true, mock: true };
    const off = { sdk: false, mock: false };
    expect(requiresSkipReason(['key.color'], 'tvos', off)).toBe(
      'requires key.color: not available on tvos',
    );
    expect(requiresSkipReason(['media.state'], 'web', off)).toBe(
      'requires media.state: not available on web (dpad.sdk off)',
    );
    expect(requiresSkipReason(['app.state', 'network.mock'], 'web', off)).toBe(
      'requires app.state, network.mock: not available on web (dpad.sdk, dpad.mock off)',
    );
    expect(requiresSkipReason(['media.state'], 'web', on)).toBe(
      'requires media.state: not available on web',
    );
  });
});

describe('serialGroupOf', () => {
  it('identifies the serial describe by its location', () => {
    const location = { file: '/a.spec.ts', line: 3, column: 6 };
    expect(serialGroupOf({ file: '/a.spec.ts', annotations: [{ type: 'serial', location }] })).toBe(
      '/a.spec.ts:3:6',
    );
    expect(serialGroupOf({ file: '/a.spec.ts', annotations: [{ type: 'serial' }] })).toBe(
      '/a.spec.ts:file',
    );
    expect(serialGroupOf({ file: '/a.spec.ts', annotations: [] })).toBeNull();
  });
});
