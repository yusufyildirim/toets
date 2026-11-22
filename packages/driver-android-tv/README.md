# @dpad-tv/driver-android-tv

dpad driver for Android TV / Google TV / Fire TV emulators, built on Appium UiAutomator2 and `adb`. `@dpad-tv/test` loads it for `android-tv` projects; tests never import it.

Docs: [`docs/`](./docs/index.md). Project overview: [dpad](../../README.md).

## Development

- `pnpm test`: unit tests (mocked `adb`, emulator and WebdriverIO).
- `DPAD_ANDROID_SERIAL=emulator-5554 pnpm test:device`: the real driver against the native fixture app (`fixtures/android-tv-app`, built on demand with `pnpm fixture:build`) on a booted Android TV emulator; also writes per-action latency.
- `pnpm helper:build`: rebuilds `assets/dpad-key-hold.jar`, the on-device key-hold helper (`helper/`).
