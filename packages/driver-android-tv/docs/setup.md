# Android TV setup

The Android TV driver runs toets tests on Android TV, Google TV and Fire TV (Android based) emulators. It drives the UI through Appium UiAutomator2 and manages the app through `adb`.

## Requirements

- Android SDK with `platform-tools`, `emulator`, `cmdline-tools` and an Android TV system image, e.g. `sdkmanager "system-images;android-34;android-tv;arm64-v8a"` (`x86_64` on Intel/AMD hosts).
- `ANDROID_HOME` set (otherwise the Android Studio default location is used).
- A JDK for `avdmanager` when toets creates emulators itself.

Appium and the UiAutomator2 driver are dependencies of this package, pinned and private: nothing is installed globally, and a global Appium install is neither needed nor used. Each worker starts its own Appium server on a free port.

## Configure the app

App specifics live in your config, never in toets:

```ts
import { defineConfig, platforms } from '@toets/test';

export default defineConfig({
  app: {
    androidTV: {
      package: 'com.example.tv',
      apk: './build/app-debug.apk', // optional: installed when the worker starts
      activity: '.MainActivity', // optional: default is the LEANBACK_LAUNCHER activity
    },
  },
  projects: [platforms.androidTV({ model: 'tv_1080p', osVersion: '34' })],
});
```

## Driver options

All optional (`AndroidTvDriverOptions`):

| Option            | Default                             | Meaning                                                                               |
| ----------------- | ----------------------------------- | ------------------------------------------------------------------------------------- |
| `sdkRoot`         | `ANDROID_HOME`                      | Android SDK root.                                                                     |
| `serial`          | `ANDROID_SERIAL`                    | Device when no device provider supplies one.                                          |
| `testIdAttribute` | `resource-id`                       | Page-source attribute used as test ID (`content-desc` is the alternative).            |
| `remote`          | `android-tv`                        | Remote whose keys the capabilities describe (`fire-tv`, see [Fire TV](./fire-tv.md)). |
| `logcat`          | `app`                               | `app`, `all`, or `false` to collect no device logs.                                   |
| `appium.url`      | driver-started server               | Use your own Appium server (it must have the `uiautomator2` driver).                  |
| `appium.settings` | see [performance](./performance.md) | UiAutomator2 settings merged over toets's defaults.                                   |
| `video`           | 4 Mbps, no `ffmpeg`                 | Screen recording bit rate; `ffmpeg` joins recordings longer than 180 s.               |
| `managed`         |                                     | [Managed device](./devices.md) settings.                                              |

## Read the launch payload in the app

`app.launch()` starts the activity with the launch payload as the intent string extra `__toets`: unpadded base64url of the JSON (`encodeLaunchPayloadParam` from `@toets/protocol`). Black-box tests need nothing in the app. To use the mock server without the SDK, read it at startup:

```kotlin
val payload = intent.getStringExtra("__toets")?.let {
    JSONObject(String(Base64.decode(it, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)))
}
val mockUrl = payload?.optString("mockUrl") // e.g. http://localhost:9400
```

Payload URLs always say `localhost`: before each launch the driver runs `adb reverse` for every port in `sdkUrl` and `mockUrl`, so `localhost` on the device reaches the host. Debug builds need cleartext HTTP allowed for `localhost`.
