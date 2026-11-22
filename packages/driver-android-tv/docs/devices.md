# Android TV devices

Each worker holds one emulator for its lifetime. Where it comes from is the device provider's job; the driver only needs its serial.

## managed

dpad creates, boots, snapshots and resets emulators itself.

- **AVD**: `dpad_<model>_api<level>_<tag>` (e.g. `dpad_tv_1080p_api34_android-tv`), created with `avdmanager` from an installed system image. dpad never downloads images; a missing one fails with the exact `sdkmanager` command.
- **Clean snapshot**: on first use the AVD is cold-booted once and saved as the `dpad_clean` snapshot. Creation is locked across worker processes.
- **Workers** boot `-read-only` instances from `dpad_clean`: several run at once, none can change the snapshot, and boots take seconds instead of minutes.
- **Reset**: restoring `dpad_clean` (`adb emu avd snapshot load`) returns the whole device to a known state; released emulators are reused this way.
- **Reuse across runs**: with `reuse: true`, emulators stay up after the run and the next run adopts them.

```ts
import { platforms } from '@dpad-tv/test';

platforms.androidTV({
  model: 'tv_1080p',
  osVersion: '34',
  managed: { reuse: true, emulatorArgs: ['-gpu', 'swiftshader_indirect'] },
});
```

| `managed` option | Default                        |
| ---------------- | ------------------------------ |
| `imageTag`       | `android-tv` (or `google-tv`)  |
| `abi`            | host architecture              |
| `headless`       | `true`                         |
| `reuse`          | `false`                        |
| `bootTimeoutMs`  | `300000`                       |
| `basePort`       | `5554` (worker `n` from `+2n`) |
| `emulatorArgs`   | none                           |
| `avdHome`        | `ANDROID_AVD_HOME`             |

## external

You start the emulators; dpad hands them out by worker index (`DPAD_DEVICES=emulator-5554,emulator-5556`) (`devices: { mode: 'external' }`, see `@dpad-tv/test`). The driver waits for boot on start.

## command

A lease broker or device farm leases and releases devices through commands that print JSON (see `@dpad-tv/test`). Return the `adb` serial as the address. `prepareAndroidDevice(serial)` waits for boot and reports API level and whether it is a TV, so a broker integration can fail fast.

## CI

Android emulators need hardware acceleration: Linux with KVM (`/dev/kvm` accessible) or macOS. Cache the SDK system image and the AVD directory (it holds `dpad_clean`) between runs to skip the cold boot.

## Trap

App data and device state are separate. `app.reset()` clears app data (`pm clear`); it does not undo device-level changes such as settings a test toggled. Restore the snapshot for that.
