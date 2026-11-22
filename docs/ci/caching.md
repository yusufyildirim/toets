---
description: What to cache for dpad in CI and how to key it - packages, browsers, Android images and snapshots, Appium drivers, WebDriverAgent and app builds.
---

# Caching

Device-backed runs spend most of their setup time downloading and booting. Cache what is **slow and deterministic**, and key each cache by exactly the inputs that change it.

| What                   | Path (typical)                                                             | Key by                                   |
| ---------------------- | -------------------------------------------------------------------------- | ---------------------------------------- |
| Package manager store  | handled by `actions/setup-node` `cache:`                                   | lockfile hash                            |
| Playwright browsers    | `~/.cache/ms-playwright` (Linux), `~/Library/Caches/ms-playwright` (macOS) | Playwright version                       |
| Android system image   | `$ANDROID_HOME/system-images`, `$ANDROID_HOME/emulator`                    | image ID                                 |
| AVD and boot snapshot  | `~/.android/avd`                                                           | image ID, emulator version, dpad version |
| Appium and its drivers | `~/.appium`                                                                | dpad version                             |
| WebDriverAgent build   | `~/Library/Developer/Xcode/DerivedData/WebDriverAgent-*`                   | dpad version, Xcode version              |
| App build              | your build output                                                          | hash of the app's sources                |

```yaml
# The lockfile hash stands in for the dpad version; bump CACHE_EPOCH when you update the emulator.
- uses: actions/cache@v4
  with:
    path: ~/.android/avd
    key: avd-${{ runner.os }}-${{ env.ANDROID_TV_IMAGE }}-${{ env.CACHE_EPOCH }}-${{ hashFiles('package-lock.json') }}
```

## Traps

- **Snapshots are not portable.** An AVD snapshot taken with another emulator version or host CPU may fail to load, and the emulator silently cold-boots. Include the emulator version in the key.
- **Do not cache app data or test results.** Each run must start from a clean device state; dpad resets devices for that reason.
- **Restore keys can hide breakage.** A partial match may restore a cache built for another image or Xcode. Prefer exact keys for device caches.
