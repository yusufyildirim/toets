import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeviceLease, DriverCreateContext, DriverModule } from '@toets/core';
import { FakeDriver } from '@toets/core/testing';
import { describe, expect, it } from 'vitest';
import { loadMcpConfig, validateMcpConfig } from '../src/config.js';
import { connect } from './helpers.js';

const fixtures = fileURLToPath(new URL('./fixtures', import.meta.url));
const fakeDriver = join(fixtures, 'fake-driver-module.ts');

describe('config', () => {
  it('lists every problem of an invalid config', () => {
    expect(() => validateMcpConfig({ targets: { web: { driver: 42 } }, extra: true })).toThrow(
      /targets\.web\.driver: expected a driver package name[\s\S]*Unrecognized key: "extra"/,
    );
    expect(() =>
      validateMcpConfig({ targets: { web: { driver: 'x' } }, defaultTarget: 'tv' }),
    ).toThrow(/defaultTarget: defaultTarget must name one of the targets/);
    expect(() => validateMcpConfig({ targets: {} })).toThrow(/at least one target/);
    expect(() =>
      validateMcpConfig({ targets: { tv: { driver: 'x', devices: { mode: 'farm' } } } }),
    ).toThrow(/targets\.tv\.devices/);
    expect(() =>
      validateMcpConfig({ targets: { tv: { driver: 'x', toets: { sdk: true, steps: {} } } } }),
    ).toThrow(/targets\.tv\.toets: Unrecognized key: "steps"/);
  });

  it('loads a JSON config and lazily imports its driver module by path', async () => {
    const loaded = await loadMcpConfig('json-config/toets.mcp.config.json', fixtures);
    expect(loaded).toMatchObject({ kind: 'mcp', config: { expectTimeoutMs: 1000 } });
    const h = await connect({ config: loaded!.config, baseDir: loaded!.baseDir });
    expect(await h.ok('launch')).toContain('Focus: hello "From JSON"');
  });

  it('discovers a TS config in the working directory and honors defaultTarget', async () => {
    const loaded = await loadMcpConfig(undefined, join(fixtures, 'ts-config'));
    expect(loaded?.file).toMatch(/toets\.mcp\.config\.ts$/);
    const h = await connect({ config: loaded!.config, baseDir: loaded!.baseDir });
    expect(await h.ok('launch')).toContain('"Second"');
    // Switching targets stops the previous driver and starts the other one.
    const out = await h.ok('launch', { target: 'first' });
    expect(out).toContain('Launched on target "first"');
    expect(out).toContain('"From TS"');
    expect(await h.err('launch', { target: 'tizen' })).toContain(
      'Configured targets: first, second',
    );
  });

  it('returns null without a config and fails clearly for a missing file', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'toets-mcp-'));
    expect(await loadMcpConfig(undefined, empty)).toBeNull();
    await expect(loadMcpConfig('nope.json', empty)).rejects.toThrow(/not found/);
  });
});

describe('toets test config', () => {
  it('turns platforms.*() projects into targets, like the test runner sees them', async () => {
    const loaded = await loadMcpConfig(undefined, join(fixtures, 'test-config'));
    expect(loaded).toMatchObject({
      kind: 'test',
      file: expect.stringMatching(/playwright\.config\.ts$/),
    });
    const { targets } = loaded!.config;
    expect(Object.keys(targets)).toEqual(['web', 'web-kids']);
    expect(targets.web).toMatchObject({
      driver: '../fake-driver-module.ts',
      platform: 'web',
      options: { label: 'From Playwright' },
      expectTimeoutMs: 1500,
      toets: { keyOverrides: { FAST_FORWARD: { as: 'RIGHT', holdMs: 800 } } },
    });
    expect(targets['web-kids']).toMatchObject({
      expectTimeoutMs: 700,
      toets: { timeouts: { actionMs: 900 }, keyOverrides: { FAST_FORWARD: { as: 'RIGHT' } } },
    });

    const h = await connect({ config: loaded!.config, baseDir: loaded!.baseDir });
    expect(await h.ok('capabilities')).toContain('FAST_FORWARD = hold RIGHT 800ms');
    expect(await h.ok('launch')).toContain('Focus: hello "From Playwright"');
    expect(await h.ok('launch', { target: 'web-kids' })).toContain('"Kids"');
  });

  it('prefers an MCP config and skips test configs without toets projects', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'toets-mcp-'));
    await writeFile(
      join(dir, 'playwright.config.mjs'),
      'export default { projects: [{ name: "unit" }] };',
    );
    const logs: string[] = [];
    expect(await loadMcpConfig(undefined, dir, (m) => logs.push(m))).toBeNull();
    expect(logs.join('\n')).toContain('has no toets projects; skipped');
    await expect(loadMcpConfig('playwright.config.mjs', dir)).rejects.toThrow(/no toets projects/);

    await writeFile(
      join(dir, 'toets.mcp.config.json'),
      JSON.stringify({ targets: { fake: { driver: fakeDriver } } }),
    );
    expect(await loadMcpConfig(undefined, dir)).toMatchObject({ kind: 'mcp' });
  });
});

describe('targets come up like test workers', () => {
  it('rejects modules that are not drivers and drivers of another platform', async () => {
    const h = await connect({
      config: {
        targets: {
          bogus: { driver: './not-a-driver.ts' },
          tv: { driver: './fake-driver-module.ts', platform: 'android-tv' },
        },
      },
      baseDir: fixtures,
    });
    expect(await h.err('launch')).toContain('INVALID_DRIVER');
    expect(await h.err('launch', { target: 'tv' })).toContain('but the project is android-tv');
  });

  it('explains how to install a missing driver package', async () => {
    const h = await connect({
      config: { targets: { tv: { driver: '@toets/driver-nope' } } },
      baseDir: fixtures,
    });
    const out = await h.err('capabilities');
    expect(out).toContain('MODULE_NOT_FOUND');
    expect(out).toContain('npm install -D @toets/driver-nope');
  });

  it('passes managed and external devices to the driver and releases them', async () => {
    const events: string[] = [];
    const contexts: DriverCreateContext[] = [];
    const module: DriverModule<never> = {
      platform: 'android-tv',
      async createDriver(_options, ctx) {
        contexts.push(ctx);
        return new FakeDriver({ root: {} });
      },
      createDeviceProvider: () => ({
        async acquire(spec): Promise<DeviceLease> {
          events.push(`acquire ${spec.model}@${spec.osVersion}`);
          return {
            id: 'lease',
            platform: 'android-tv',
            address: 'emulator-5554',
            meta: {},
            release: async () => void events.push('release'),
          };
        },
        dispose: async () => void events.push('dispose'),
      }),
    };
    const h = await connect({
      config: {
        targets: {
          managed: { driver: module, devices: 'managed', model: 'tv_1080p', osVersion: '34' },
          external: { driver: module, devices: { mode: 'external', addresses: ['emulator-5556'] } },
        },
      },
    });
    await h.ok('capabilities', { target: 'managed' });
    expect(contexts[0]?.device?.address).toBe('emulator-5554');
    await h.ok('capabilities', { target: 'external' });
    expect(events).toEqual(['acquire tv_1080p@34', 'release', 'dispose']);
    expect(contexts[1]?.device?.address).toBe('emulator-5556');
  });

  it('starts the @toets/mock server when mocking is on', async () => {
    const h = await connect({ target: () => ({ toets: { mock: { port: 0 } } }) });
    const out = await h.ok('capabilities');
    expect(out).toMatch(/Network mocking: on \(http:\/\/[^)]+\)/);
  });
});
