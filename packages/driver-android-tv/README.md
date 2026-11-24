# @toets/driver-android-tv

toets driver for Android TV / Google TV / Fire TV emulators, built on Appium UiAutomator2 and `adb`. `@toets/test` loads it for `android-tv` projects; tests never import it.

Docs: [`docs/`](./docs/index.md). Project overview: [toets](https://github.com/yusufyildirim/toets#readme).

## Development

- `pnpm test`: unit tests (mocked `adb`, emulator and WebdriverIO).
- `TOETS_ANDROID_SERIAL=emulator-5554 pnpm test:device`: the real driver against the native fixture app (`fixtures/android-tv-app`, built on demand with `pnpm fixture:build`) on a booted Android TV emulator; also writes per-action latency.
- `pnpm helper:build`: rebuilds `assets/toets-key-hold.jar`, the on-device key-hold helper (`helper/`).
