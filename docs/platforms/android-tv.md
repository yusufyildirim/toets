---
description: The Android TV platform drives apps on Android TV emulators through Appium UiAutomator2, with emulators booted, leased and reset by dpad. Covers Fire TV apps on Android TV images.
---

# Android TV / Fire TV

Runs the app on Android TV emulators through Appium UiAutomator2. dpad manages the Appium server and, by default, the emulators: one per worker, created from an Android TV system image, snapshotted and reset between tests. Package: [`@dpad-tv/driver-android-tv`](../reference/driver-android-tv.md).

```ts
import { defineConfig, platforms } from '@dpad-tv/test';

export default defineConfig({
  app: { androidTV: { apk: './build/app-debug.apk', package: 'com.example.tv' } },
  projects: [platforms.androidTV({ model: 'tv_1080p', osVersion: '34' })],
});
```

**Host:** the Android SDK with an Android TV system image, and hardware acceleration (macOS, or Linux with KVM). See [Android TV on Linux](../ci/android.md) for CI.

| Aspect    | Android TV                                                                           |
| --------- | ------------------------------------------------------------------------------------ |
| Test ID   | view resource ID                                                                     |
| Focus     | the focused view, or the SDK's focus when connected                                  |
| Keys      | Android keycodes; all TV keys including color, numeric, channel and media            |
| Launch    | launch payload as the `__dpad` intent extra; host ports forwarded with `adb reverse` |
| Artifacts | logcat, screen recording (`dpad.video`)                                              |

Options (SDK path, Appium, remote profile, logcat, managed emulators): [Android TV setup](../reference/driver-android-tv/docs/setup.md) and [devices](../reference/driver-android-tv/docs/devices.md).

## Devices

| Mode       | Who owns the emulator                                                                                 |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| `managed`  | dpad: creates, boots, snapshots, resets and shuts down emulators (default)                            |
| `external` | you: running devices, `devices: { mode: 'external' }` with `DPAD_DEVICES=emulator-5554,emulator-5556` |
| `command`  | your scripts: shell commands lease and release devices (device farms, lease brokers)                  |

## Fire TV

Fire TV apps (Fire OS) are Android apps; test them on Android TV emulators with `platforms.androidTV({ remote: 'fire-tv' })`, which limits the keys to the Alexa Voice Remote's. Amazon services (IAP, ADM) are not on Android TV images; fake them in the app's test build. Vega OS is not supported. See [Fire TV](../reference/driver-android-tv/docs/fire-tv.md).

## Traps

- **Emulators need hardware acceleration.** Without KVM or the macOS hypervisor they are too slow to be useful.
- **First boot is slow; later boots are not.** Managed mode snapshots a booted emulator and restores it. Keep the AVD and snapshot cached in CI.
- **`localhost` on the device is the device.** dpad forwards the ports in the launch payload; if your app talks to other host services, forward them yourself or use the mock server.
- **Resource IDs need to be set.** Views without an ID are invisible to `getByTestId`; React Native sets it from `testID`.
