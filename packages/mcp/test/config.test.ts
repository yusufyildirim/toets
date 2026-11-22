import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeviceLease, DriverCreateContext, DriverModule } from '@dpad-tv/core';
import { FakeDriver } from '@dpad-tv/core/testing';
import { describe, expect, it } from 'vitest';
import { loadMcpConfig, validateMcpConfig } from '../src/config.js';
import { loadDriverModule } from '../src/driver-loader.js';
import { connect } from './helpers.js';

const fixtures = fileURLToPath(new URL('./fixtures', import.meta.url));

describe('config', () => {
  it('lists every problem of an invalid config', () => {
    expect(() => validateMcpConfig({ targets: { web: { driver: 42 } }, extra: true })).toThrow(
      /targets\.web\.driver: expected a driver package name[\s\S]*Unrecognized key: "extra"/,
    );
    expect(() =>
      validateMcpConfig({ targets: { web: { driver: 'x' } }, defaultTarget: 'tv' }),
    ).toThrow(/defaultTarget: defaultTarget must name one of the targets/);
    expect(() => validateMcpConfig({ targets: {} })).toThrow(/at least one target/);
  });

  it('loads a JSON config and lazily imports its driver module by path', async () => {
    const loaded = await loadMcpConfig('json-config/dpad.mcp.config.json', fixtures);
    expect(loaded?.config.expectTimeoutMs).toBe(1000);
    const h = await connect({ config: loaded!.config, baseDir: loaded!.baseDir });
    expect(await h.ok('launch')).toContain('Focus: focusable [testId=hello, focused]: "From JSON"');
  });

  it('discovers a TS config in the working directory and honors defaultTarget', async () => {
    const loaded = await loadMcpConfig(undefined, join(fixtures, 'ts-config'));
    expect(loaded?.file).toMatch(/dpad\.mcp\.config\.ts$/);
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
    const empty = await mkdtemp(join(tmpdir(), 'dpad-mcp-'));
    expect(await loadMcpConfig(undefined, empty)).toBeNull();
    await expect(loadMcpConfig('nope.json', empty)).rejects.toThrow(/not found/);
  });
});

describe('driver loading', () => {
  it('rejects modules that are not drivers', async () => {
    await expect(loadDriverModule('./not-a-driver.ts', fixtures)).rejects.toMatchObject({
      code: 'MCP_DRIVER_INVALID',
    });
  });

  it('explains how to install a missing driver package', async () => {
    await expect(loadDriverModule('@dpad-tv/driver-nope', fixtures)).rejects.toMatchObject({
      code: 'MCP_DRIVER_NOT_FOUND',
      hint: expect.stringContaining('pnpm add -D @dpad-tv/driver-nope'),
    });
  });

  it('passes external and managed devices to the driver and releases them', async () => {
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
          events.push(`acquire ${spec.model}`);
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
          managed: { driver: module, device: { managed: true, model: 'tv_1080p' } },
          external: { driver: module, device: { address: 'emulator-5556' } },
        },
      },
    });
    await h.ok('capabilities', { target: 'managed' });
    expect(contexts[0]?.device?.address).toBe('emulator-5554');
    await h.ok('capabilities', { target: 'external' });
    expect(events).toEqual(['acquire tv_1080p', 'release', 'dispose']);
    expect(contexts[1]?.device?.address).toBe('emulator-5556');
  });
});
