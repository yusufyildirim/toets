---
description: The Android TV platform drives apps on Android TV emulators through Appium UiAutomator2, with emulators booted, leased and reset by dpad. Covers Fire TV apps on Android TV images.
---

# Android TV / Fire TV

Runs the app on Android TV emulators through Appium UiAutomator2. dpad manages the Appium server and, by default, the emulators: one per worker, created from an Android TV system image, snapshotted and reset between tests. Package: [`@dpad-tv/driver-android-tv`](../reference/driver-android-tv.md).

```ts
import { defineConfig, platforms } from '@dpad-tv/test';

export default defineConfig({
  app: { androidTV: { apk: './build/app-debug.apk', package: 'com.example.tv' } },
  projects: [platforms.androidTV({ avd: 'tv_1080p', api: 34 })],
});
```

**Host:** the Android SDK with an Android TV system image, and hardware acceleration (macOS, or Linux with KVM). See [Android TV on Linux](../ci/android.md) for CI.

| Aspect    | Android TV                                                                           |
| --------- | ------------------------------------------------------------------------------------ |
| Test ID   | view resource ID                                                                     |
| Focus     | the focused view, or the SDK's focus when connected                                  |
| Keys      | Android keycodes; all TV keys including color, numeric, channel and media            |
| Launch    | launch payload as the `__dpad` intent extra; host ports forwarded with `adb reverse` |
| Artifacts | logcat, screen recording, screenshots per step                                       |

## Devices

| Mode       | Who owns the emulator                                                                |
| ---------- | ------------------------------------------------------------------------------------ |
| `managed`  | dpad: creates, boots, snapshots, resets and shuts down emulators (default)           |
| `external` | you: list running devices, for example `DPAD_DEVICES=emulator-5554,emulator-5556`    |
| `command`  | your scripts: shell commands lease and release devices (device farms, lease brokers) |

## Fire TV

Fire TV apps are Android apps; test them on Android TV emulators. Fire TV-only services (Amazon IAP, ADM) are covered by platform shims as they arrive; Vega OS is a later phase.

## Traps

- **Emulators need hardware acceleration.** Without KVM or the macOS hypervisor they are too slow to be useful.
- **First boot is slow; later boots are not.** Managed mode snapshots a booted emulator and restores it. Keep the AVD and snapshot cached in CI.
- **`localhost` on the device is the device.** dpad forwards the ports in the launch payload; if your app talks to other host services, forward them yourself or use the mock server.
- **Resource IDs need to be set.** Views without an ID are invisible to `getByTestId`; React Native sets it from `testID`.
