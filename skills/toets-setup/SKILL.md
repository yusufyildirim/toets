---
name: toets-setup
description: Set up toets (@toets/test) for TV end-to-end tests in a project, add a platform (web, Android TV / Fire TV, tvOS), wire the optional in-app SDK or network mocking into the app, or create CI jobs for toets. Use when installing toets, creating or changing its playwright.config.ts, preparing emulators or simulators, or writing CI workflows that run toets tests.
---

# Setting up toets

Order matters here: get one test green on web before adding device platforms, CI or the SDK.

Docs are referenced by slug, for example `getting-started`: the docs site page `/<slug>`, also served as markdown at `/<slug>.md` (until the site is hosted: under `docs/` in the toets repository). Package reference pages (`reference/<package>/docs/<page>`) ship offline in each installed package's `docs/`; errors print the exact path.

## 1. Inspect the project

Find out before installing anything:

- The app's framework and which TV platforms it builds for, and the commands that build each (web bundle and port, debug APK, tvOS simulator `.app`).
- Whether Playwright is already used; toets shares its runner and config file.
- The host OS: Android TV needs macOS or Linux with KVM, tvOS needs macOS with Xcode.

## 2. Install and configure

Follow `getting-started` exactly:

- `@toets/test` and `@playwright/test`, plus one driver package per targeted platform (`@toets/driver-web`, `-android-tv`, `-tvos`).
- `playwright.config.ts` with `defineConfig` from `@toets/test`: an `app` entry per platform (how to start the app) and a `platforms.*()` project per platform (where tests run). Project names are `web`, `android-tv`, `tvos`. Options: `reference/test/docs/config`.
- toets does not serve or build the app: use Playwright's `webServer` for the web build; point `app.androidTV.apk` and `app.tvOS.app` at build outputs.
- App-specific flows (splash, sign-in, consent) go into a fixture in the project, never into toets config. (`guides/writing-tests`)

## 3. First test on web

1. Make sure the elements the test needs have test IDs (`testID` in React Native, `data-testid` on web).
2. Write one smoke test: launch, navigate to one element, assert focus, press `SELECT`, assert the next screen. Use the toets-write-tests skill.
3. `npx playwright test --project=web` until green.

## 4. Add device platforms

One at a time, each green before the next. Prefer `managed` devices: toets boots, snapshots and resets emulators and simulators.

- Android TV / Fire TV: Android SDK, an Android TV system image, hardware acceleration. (`platforms/android-tv`)
- tvOS: Xcode, a tvOS simulator runtime, an `.app` built with `-sdk appletvsimulator`. (`platforms/tvos`)

Tests that fail only on a new platform are often real differences (focus engine, missing keys). Use `requires` for capability gaps; do not branch on the platform. (`concepts/capabilities`)

## 5. Optional app cooperation

Each is independent; add only what the tests need.

- **Network mocking**: `toets: { mock: true }` in the config (or `mock: { handlers }` for baseline handlers every test gets), and the app sends API traffic to the launch payload's `mockUrl` with the real origin in a header. (`concepts/network-mocking`, `reference/mock/docs/app-integration`)
- **In-app SDK**: `toets: { sdk: true }` in the config, and the app starts the SDK; adds idle sync, focus graph, media state, named states. Debug or test builds only, never production. (`concepts/sdk`, `reference/sdk/docs/overview`, `reference/sdk-react-native/docs/react-native`)

## 6. Guardrails for agents and humans

- Add the toets section to the project's `AGENTS.md` from the template in `getting-started/agents`.
- Enable the `@toets/eslint-plugin` recommended config for the test folder.
- Install the toets skills if they are not already present. (`getting-started/agents`)

## 7. CI

Read `ci` first, then the recipe per platform. toets ships no CI actions; adapt the recipes.

- Web: any Linux runner. Android TV: x86_64 Linux with KVM enabled. tvOS: macOS with a pinned Xcode. (`ci/android`, `ci/tvos`)
- Build the app once per platform and pass it to test jobs as an artifact.
- Cache system images, AVD snapshots and WebDriverAgent with exact keys. (`ci/caching`)
- Always upload `playwright-report/`, `test-results/` and `toets-report/` (parity matrix), also on failure. (`ci/artifacts`)

## Done when

- `npx playwright test` passes, or skips with reasons (see `toets-report/parity.md`), on every targeted platform locally.
- A setup error (`ToetsError: [CODE] ...`) was fixed from its `Hint:`; unknown codes are in `reference/core/docs/errors`.
- CI runs every targeted platform and keeps the report.
- The project's `AGENTS.md` has the toets section.

Report what was installed, the config decisions (platforms, device mode, app commands) and the verification commands with their results.
