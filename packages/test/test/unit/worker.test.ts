import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DpadError } from '@dpad-tv/core';
import { FakeMockServer, FakeSdkHost } from '@dpad-tv/core/testing';
import { http, HttpResponse } from '@dpad-tv/mock';
import { describe, expect, it } from 'vitest';
import {
  platforms,
  type DpadProjectConfig,
  type PlatformProjectOptions,
} from '../../src/config.js';
import { DpadWorker } from '../../src/worker.js';
import { registry } from '../e2e/fake-app.js';

const e2eDir = join(dirname(new URL(import.meta.url).pathname), '..', 'e2e');

const configOf = (
  platform: 'web' | 'tvOS' | 'androidTV',
  opts: PlatformProjectOptions = {},
): DpadProjectConfig => (platforms[platform](opts).use as { dpad: DpadProjectConfig }).dpad;

async function dpadError(promise: Promise<unknown>): Promise<DpadError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(DpadError);
  return error as DpadError;
}

describe('DpadWorker', () => {
  const ctx = () => ({
    workerIndex: 0,
    parallelIndex: 0,
    configDir: e2eDir,
    artifactsDir: join(mkdtempSync(join(tmpdir(), 'dpad-worker-')), 'w0'),
    log: () => {},
  });

  it('starts driver, mock and SDK host, and stops them', async () => {
    const config = configOf('web', {
      driver: './fake-web-driver.ts',
      dpad: {
        mock: { createServer: async () => (registry.mock = new FakeMockServer()) },
        sdk: {
          createHost: async () => {
            if (!registry.driver) throw new Error('driver must exist before the SDK host');
            return (registry.host = new FakeSdkHost(registry.driver));
          },
        },
      },
    });
    const worker = await DpadWorker.start(config, ctx());
    expect(worker.driver).toBe(registry.driver);
    expect(registry.driver?.started).toBe(true);
    expect(worker.runtime.declaredCapabilities.has('network.mock')).toBe(true);
    expect(worker.runtime.declaredCapabilities.has('sync.idle')).toBe(true);
    await worker.stop(() => {});
    expect(registry.driver?.stopped).toBe(true);
    expect(registry.mock?.closed).toBe(true);
  });

  it('runs the real mock server and SDK host by default', async () => {
    const config = configOf('web', {
      driver: './fake-web-driver.ts',
      dpad: { mock: true, sdk: true },
    });
    const worker = await DpadWorker.start(config, ctx());
    const { mock, sdkHost } = worker.runtime;
    try {
      expect(sdkHost?.url).toMatch(/^ws:\/\/localhost:\d+$/);
      expect(sdkHost?.issueToken()).toEqual(expect.any(String));
      expect(mock?.url).toMatch(/^http:\/\/localhost:\d+$/);
      mock?.use(http.get('https://api.example.com/v1/ping', () => HttpResponse.json({ ok: true })));
      const res = await fetch(`${mock?.url}/v1/ping`, {
        headers: { 'x-dpad-original-origin': 'https://api.example.com' },
      });
      expect(await res.json()).toEqual({ ok: true });
      expect(mock?.requests({ url: '/v1/ping' })).toHaveLength(1);
      expect(mock?.toHar?.()).toMatchObject({ log: { version: '1.2' } });
    } finally {
      await worker.stop(() => {});
    }
    await expect(fetch(`${mock?.url}/v1/ping`)).rejects.toThrow();
  });

  it('checks that the driver drives the project platform', async () => {
    const error = await dpadError(
      DpadWorker.start(configOf('tvOS', { driver: './fake-web-driver.ts' }), ctx()),
    );
    expect(error.code).toBe('INVALID_DRIVER');
    expect(error.message).toContain('drives web, but the project is tvos');
  });

  it('tears down what it started when a later step fails', async () => {
    const config = configOf('web', {
      driver: './fake-web-driver.ts',
      dpad: {
        mock: { createServer: async () => (registry.mock = new FakeMockServer()) },
        sdk: { createHost: () => Promise.reject(new Error('port in use')) },
      },
    });
    await expect(DpadWorker.start(config, ctx())).rejects.toThrow('port in use');
    expect(registry.driver?.stopped).toBe(true);
    expect(registry.mock?.closed).toBe(true);
  });
});
