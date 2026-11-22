import { describe, expect, it } from 'vitest';
import {
  createCommandDeviceProvider,
  createExternalDeviceProvider,
  devicesFromEnv,
} from '../src/index.js';

const spec = { platform: 'android-tv' as const, model: 'tv_1080p' };
const node = (code: string) => `${JSON.stringify(process.execPath)} -e ${JSON.stringify(code)}`;

describe('external devices', () => {
  it('hands each worker slot its own address', async () => {
    const provider = createExternalDeviceProvider({
      addresses: ['emulator-5554', 'emulator-5556'],
    });
    const lease = await provider.acquire(spec, { workerIndex: 7, parallelIndex: 1 });
    expect(lease).toMatchObject({
      id: 'emulator-5556',
      address: 'emulator-5556',
      platform: 'android-tv',
    });
    await expect(
      provider.acquire(spec, { workerIndex: 8, parallelIndex: 2 }),
    ).rejects.toMatchObject({
      code: 'NOT_ENOUGH_DEVICES',
    });
  });

  it('reads DPAD_DEVICES and explains when it is empty', async () => {
    expect(devicesFromEnv({ DPAD_DEVICES: ' a, ,b ' })).toEqual(['a', 'b']);
    const provider = createExternalDeviceProvider({ addresses: [] });
    await expect(
      provider.acquire(spec, { workerIndex: 0, parallelIndex: 0 }),
    ).rejects.toMatchObject({
      code: 'NO_DEVICES',
    });
  });
});

describe('command devices', () => {
  it('leases through shell commands with DPAD_* variables', async () => {
    const provider = createCommandDeviceProvider({
      acquire: node(
        'console.log("booting"); console.log(JSON.stringify({ address: "emulator-" + (5554 + 2 * Number(process.env.DPAD_PARALLEL_INDEX)), id: "lease-" + process.env.DPAD_WORKER_INDEX, meta: { spec: JSON.parse(process.env.DPAD_DEVICE_SPEC) } }))',
      ),
      release: node('if (process.env.DPAD_DEVICE_ID !== "lease-3") process.exit(1)'),
    });
    const lease = await provider.acquire(spec, { workerIndex: 3, parallelIndex: 1 });
    expect(lease).toMatchObject({ id: 'lease-3', address: 'emulator-5556', meta: { spec } });
    await lease.release();
    await lease.release();
    await provider.dispose();
  });

  it('explains bad output and failing commands', async () => {
    const bad = createCommandDeviceProvider({ acquire: node('console.log("ready")') });
    await expect(bad.acquire(spec, { workerIndex: 0, parallelIndex: 0 })).rejects.toMatchObject({
      code: 'DEVICE_COMMAND_OUTPUT',
    });
    const failing = createCommandDeviceProvider({
      acquire: node('console.error("no devices left"); process.exit(3)'),
    });
    const err = await failing
      .acquire(spec, { workerIndex: 0, parallelIndex: 0 })
      .catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'DEVICE_COMMAND_FAILED' });
    expect((err as Error).message).toContain('no devices left');
  });
});
