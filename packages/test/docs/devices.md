# Devices

Device platforms need a device per worker. A project picks how it gets one with `devices`; web needs none.

```ts
import { platforms } from '@toets/test';

platforms.androidTV({ devices: 'managed', model: 'tv_1080p', osVersion: '34' });
platforms.androidTV({
  devices: { mode: 'external', addresses: ['emulator-5554', 'emulator-5556'] },
});
platforms.tvOS({
  devices: {
    mode: 'command',
    acquire: './scripts/lease-sim.sh',
    release: './scripts/release-sim.sh',
  },
});
```

| Mode       | Who provides the device                                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `managed`  | The driver creates, boots, snapshots and resets emulators or simulators. Default when the driver supports it.           |
| `external` | Already running devices, from `addresses` or `TOETS_DEVICES=emulator-5554,emulator-5556`. Worker slot n uses address n. |
| `command`  | Your shell commands lease and release devices (device farms, lease brokers).                                            |

## The command contract

- `acquire` gets `TOETS_PLATFORM`, `TOETS_WORKER_INDEX`, `TOETS_PARALLEL_INDEX` and `TOETS_DEVICE_SPEC` (JSON), and prints JSON on its last stdout line: `{ "address": "emulator-5554", "id"?: "...", "meta"?: { ... }, "environment"?: { ... } }`. `environment` holds variables the device must be driven with (e.g. a lease broker's `ANDROID_ADB_SERVER_PORT` or `SIMLOCK_IOS_DEVICE_SET`); it lands in `meta.environment` and drivers apply it.
- `release` gets the same variables plus `TOETS_DEVICE_ID`, `TOETS_DEVICE_ADDRESS` and `TOETS_DEVICE_META`.
- Timeouts: `acquireTimeoutMs` (default 10 minutes, boots are slow) and `releaseTimeoutMs` (2 minutes).

## Principles

- **One device per worker, held for the worker's life.** The lease is released when the worker exits, including after failures.
- **`TOETS_PARALLEL_INDEX` is the stable slot** (`0..workers-1`), kept when Playwright replaces a crashed worker. Use it, not the worker index, to pick an exclusive device.
- **Fewer devices than workers fails fast** with `NOT_ENOUGH_DEVICES` instead of sharing a device between workers.

## TV trap: emulators need KVM, simulators need macOS

Android TV emulators need hardware acceleration (KVM on Linux CI). tvOS simulators run only on macOS. Plan CI runners per platform and keep device projects separate so they can run on different machines.
