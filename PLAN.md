# dpad v1 implementation plan

Source of truth for goals and decisions: [VISION.md](./VISION.md). This file splits v1 into parallel workstreams with clear ownership and contracts.

## Phases

| Phase | What                                                                                                                                                                       | Status  |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 0     | Foundation: monorepo, tooling, shared contracts (`core` types, `protocol` types), FakeDriver                                                                               | done    |
| 1     | Parallel build: streams S1-S9 below, each in its own worktree/branch                                                                                                       | done    |
| 2     | Integration: example app wired to the SDK, one cross-platform E2E suite green on web + Android TV + tvOS, docs finalized against real APIs, skills, fresh-agent dogfooding | done    |
| 3     | Release prep: changesets, versioning, publish under `@dpad-tv` (needs the owner)                                                                                           | pending |

## Rules for every stream

- **Read first:** `AGENTS.md`, `VISION.md`, this file (your section + Contracts).
- **Ownership:** change only the paths you own. Shared contract files (`packages/core/src/{api,driver,devices,keys,capabilities,selectors,snapshot,errors}.ts`, `packages/protocol/src/*.ts`) are owned by S1 (core) and S5 (protocol). Other streams may make minimal, additive contract changes when truly needed and must list them in their final report.
- **Branch:** work on the branch your thread was created with. Commit early and often with concise messages. Never merge to `main`; the orchestrator merges.
- **Lockfile:** `pnpm-lock.yaml` conflicts are expected and resolved by the orchestrator. Add deps normally with `pnpm add`.
- **Quality gate:** `pnpm check` (format, lint, typecheck, unit tests) passes for your packages before you report done.
- **Tests:** Vitest unit tests, using `FakeDriver` from `@dpad-tv/core/testing` where a driver is needed. Real-target verification where your section says so.
- **Docs are part of done:** TSDoc on every public API; concise pages in your package's `docs/` (one concept per page, one minimal example, principles over procedures, state the TV-specific trap). Errors are `DpadError` with `code`, `hint`, `docs` slug.
- **Devices:** this machine shares emulators/simulators through simlock. Run `simlock instructions` and follow it. Never run `adb`, `emulator`, `avdmanager` or `xcrun simctl` directly; use `simlock adb -s <address>` / `simlock simctl` or the lease's environment. Lease, use, release. Product code may call those tools (that is what drivers do); during development point them at your leased device.
- **No em dash** anywhere. Use `-`.
- **Final report** (last message): what was built, what was verified and how (commands + results), contract changes, known gaps, follow-ups for other streams, then: `Branch <name>, head <sha>`.

## Contracts (phase 0, already in `main`)

- `@dpad-tv/core`: `Driver`, `DriverModule`, `DriverCreateContext`, `ElementSnapshot`, `UITree`, `SelectorChain`, `Key`, `KEY_CAPABILITY`, `Capability`, `DeviceProvider`/`DeviceLease`, `DpadError`, authoring API types (`App`, `Locator`, `Remote`, `Focus`, `Media`, `Network`, `PlatformInfo`). `@dpad-tv/core/testing`: `FakeDriver`.
- `@dpad-tv/protocol`: `LaunchPayload` + encode/decode + `LAUNCH_PARAM` + `ORIGINAL_ORIGIN_HEADER`, JSON-RPC types, message catalog (`HostToAppRequests`, `AppToHostNotifications`, `PROTOCOL_VERSION`, `Domain`), `SdkHost` / `SdkSession` interfaces.
- **Host URLs on devices:** payload URLs always use `localhost`. Android drivers run `adb reverse` for every port found in the payload's `sdkUrl`/`mockUrl` before launch; the tvOS simulator and web share the host network.
- **Driver packages** default-export a `DriverModule`. `@dpad-tv/test` loads them lazily by package name.
- **Mock server API** (`@dpad-tv/mock`, consumed by S1):
  ```ts
  createMockServer(opts?: { port?: number }): Promise<MockServer>
  interface MockServer {
    readonly url: string; readonly port: number;
    use(...handlers: RequestHandler[]): void; resetHandlers(): void;
    requests(filter?: { method?: string; url?: string | RegExp }): readonly RecordedRequest[];
    clearRequests(): void; close(): Promise<void>;
  }
  export { http, HttpResponse, delay } from 'msw';
  ```

## Streams

### S1 - core + test (`packages/core`, `packages/test`)

The heart. Owns core contracts and the authoring API implementation.

- Core runtime over a `Driver` (+ optional `SdkSession`): locator implementation (lazy chains), retry engine with timeouts, matchers implemented once over `ElementSnapshot` (`toBeVisible`, `toBeInViewport`, `toBeFocused`, `toHaveFocusWithin`, `toBeEnabled`, `toBeDisabled`, `toBeSelected`, `toBeBusy`, `toHaveText`, `toContainText`, `toHaveCount`, `toMatchScreenshot`), media matchers (`toBePlaying`, `toBePaused`, `toHavePosition` style), network matcher (`toHaveRequested`).
- Idle integration per decision 16: wait on SDK idle when available, never as a gate; fast negative assertions when idle; busy resource named in failures.
- Remote with key overrides (decision 17) and capability checks (throw `DpadError` with hint for unsupported keys).
- `focus.navigateTo` (SDK focus graph when available, otherwise geometry from `tree()`), `focus.waitForChange`, path reported.
- Text snapshot format (YAML, focus-aware, deterministic, cross-platform comparable) + `toMatchTextSnapshot`-style assertion; failure dump (focused element, surrounding tree, last N keys, logs).
- SDK composition: when an `SdkSession` exists, prefer SDK for tree/query/focus/media; driver for input, launch, screenshots.
- `@dpad-tv/test`: `test`, `expect` (Playwright `expect.extend` wiring + `expect.poll`), `Key`, `defineConfig`, `platforms.web()/androidTV()/tvOS()`, `app` fixture (decision 14, serial blocks share one `app`), worker-scoped driver/device/mock server/SDK host lifecycle, `test(name, { requires }, fn)` with auto-skip + reason, per-action `test.step`, attachments (decision 18), parity matrix reporter, device provider selection (`managed` / `external` / `command`).
- Verify: unit tests on `FakeDriver`; an end-to-end smoke of `@dpad-tv/test` running real Playwright Test against a fake driver module.

### S2 - web driver (`packages/driver-web`)

- `DriverModule` for Chromium via Playwright: launch = navigate with payload (`?__dpad=` or init script), query/focused/tree from DOM (`data-testid`, text, visibility, `document.activeElement`, `aria-selected`, `aria-busy`, `aria-disabled`/`disabled`), key mapping (`KeyboardEvent.key` values, configurable per app for TV web keycodes), long press via keydown/keyup with repeat, screenshots, console logs, video via Playwright, `escapeHatch()` = `Page`.
- Capability set honest to a browser.
- Verify: a small static TV-like HTML fixture app in `packages/driver-web/test/fixtures` driven through the real driver in Chromium.

### S3 - Android TV driver (`packages/driver-android-tv`)

- `DriverModule` on WebdriverIO + Appium UiAutomator2: start/stop session (manage the Appium server lifecycle), launch with payload as intent extra `__dpad`, `adb reverse` for payload ports, terminate/reset (`pm clear`), query/focused/tree from UiAutomator2 page source (resource-id = testId, text, content-desc, focused, selected, enabled, bounds), key mapping to Android keycodes (all TV keys incl. color, numeric, channel, media toggle/discrete/seek/track), long press, screenshots, logcat, `screenrecord` video.
- Device providers: `managed` (create/boot AVD from an Android TV system image, snapshot, reuse, reset), plus helpers the `command`/`external` providers need.
- Performance: avoid per-query round trips (one page-source fetch per snapshot), document latency numbers.
- Verify: a minimal native Android TV fixture app (Kotlin, focusable views with resource IDs, a fake player) in `packages/driver-android-tv/fixtures/`, proving framework neutrality; run the driver against it on a simlock-leased Android TV emulator (`tv_1080p`, API 31/33 images exist).

### S4 - tvOS driver (`packages/driver-tvos`)

- `DriverModule` on WebdriverIO + Appium XCUITest for tvOS simulators: session lifecycle, launch with payload as launch args, terminate/reset, query/focused/tree from page source (accessibilityIdentifier = testId, label/value text, hasFocus, selected, enabled, frame), key mapping to `XCUIRemote` buttons only (up/down/left/right/select/menu=BACK/playPause/home), long press, screenshots, logs, `recordVideo`.
- Device providers: `managed` (create/boot Apple TV simulators), helpers for `command`/`external`.
- Verify: a minimal SwiftUI tvOS fixture app in `packages/driver-tvos/fixtures/`, run on a tvOS simulator. Simlock currently lists Apple TV models with "no paired runtime"; try leasing first. If you can not get a tvOS simulator through simlock, do not touch simulators directly: finish everything else, verify with unit tests and report the blocker precisely.

### S5 - protocol + SDKs (`packages/protocol`, `packages/sdk`, `packages/sdk-react-native`)

- `protocol`: versioned spec document (`packages/protocol/docs/spec.md`), `SdkHost` implementation (WebSocket server, token issuing, handshake with semver check, request/response with timeouts, notifications), conformance test suite (`@dpad-tv/protocol/conformance`) any SDK can run.
- `sdk`: framework-neutral in-app runtime: reads the launch payload, inert without it, connects, handshake, domain registry, idle tracker (network via fetch/XHR wrapping, timers < 1.5s, custom `markBusy`, exclusions), logs forwarding, `state` domain hooks (`onState(name => ...)`), media registration API. Web adapter (`@dpad-tv/sdk/web`): DOM tree, focus via `document.activeElement`, CSS animations via `getAnimations()`, `<video>` media.
- `sdk-react-native`: adapter for react-native-tvos + react-native-web: payload from intent/launch args (document the tiny native glue needed), tree + focus from the RN host tree / accessibility info, `Animated`/`InteractionManager`/navigation idle hooks, media registration helpers. Production builds must be able to exclude it.
- Verify: conformance suite green for the web adapter; host + SDK round trip tests.

### S6 - mock (`packages/mock`)

- MSW-based host mock server per the Contracts API: handlers run on the host, unmatched requests proxied upstream via `ORIGINAL_ORIGIN_HEADER`, CORS, request recording, latency/failure injection helpers, HAR export of recorded traffic, per-test isolation guidance.
- App-side helper docs: how an app routes API traffic to `mockUrl` from the launch payload and sets the origin header (framework neutral; snippets for fetch/axios).
- Verify: unit + integration tests (real HTTP, proxy to a local upstream).

### S7 - example app (`examples/tv-app`)

- One React Native codebase (react-native-tvos) building for Android TV, tvOS and web (react-native-web): side menu, home with horizontal rails of focusable cards, details screen, video player (playable test stream), settings with a toggle. Stable `testID`s everywhere, deliberate focus behaviors (focus memory on rails, back navigation).
- API calls go through a small client that honors the launch payload `mockUrl` (no SDK dependency yet; SDK integration happens in phase 2).
- Build scripts producing: web bundle served on a port, debug APK, tvOS simulator `.app`.
- Verify: builds succeed for all three; app runs on a leased Android TV emulator and in Chromium (tvOS if a simulator can be leased, see S4).

### S8 - MCP + ESLint (`packages/mcp`, `packages/eslint-plugin`)

- `mcp`: MCP server (stdio) exposing dpad over the same `Driver` + core runtime: `launch`, `press`, `snapshot` (text snapshot), `screenshot`, `query`, `assert` (subset of matchers), `navigate_to`, `docs_search` (over shipped `docs/` of installed dpad packages). Develop against `FakeDriver`; real drivers plug in by platform config.
- `eslint-plugin`: flat-config plugin with rules: `no-sleep` (and raw timeouts in tests), `page-object-assertions` (only stability matchers in page objects), `no-platform-only` (warn), `prefer-semantic-keys` (no raw keycodes), `no-focus-skipping` (no direct state jumps that bypass focus where a navigation helper exists, if feasible). `recommended` config.
- Verify: unit tests for every rule (RuleTester); MCP tool tests with an MCP client against `FakeDriver`.

### S9 - docs (`docs/`, `skills/`)

- VitePress site in `docs/` with `llms.txt` / `llms-full.txt` generation, information architecture (Getting started, Concepts, Guides, Platforms, Reference, CI recipes), concept pages from VISION (focus, remote/keys, capabilities, idle, mocking, page objects, SDK), CI recipes (Android on Linux + KVM, tvOS on macOS runners, caching), and the infra that type-checks/executes code blocks in docs and skills.
- Skills (`skills/<name>/SKILL.md`, agent skills format, each < ~150 lines, linking to pages): `dpad-write-tests`, `dpad-debug-failures`, `dpad-setup`, `dpad-migrate`. Plus a short `AGENTS.md` template for user projects.
- Package `docs/` folders are owned by their streams; S9 owns site structure and pulls them in (do not rewrite their pages; leave notes in your report instead).
- Phase 1 drafts against the contracts in `main`; phase 2 finalizes against real APIs.
- Verify: site builds, `llms.txt` generated, code-block checks run.

## Phase 2 (after merges)

1. Wire `sdk-react-native` into the example app; launch-payload glue on Android/tvOS.
2. Cross-platform E2E suite in `examples/tv-app/e2e` (navigation, focus, playback, mocking, capabilities) green on web, Android TV and tvOS.
3. Docs finalized against real APIs; skills validated by a fresh agent using only shipped docs.
4. Performance pass: action latency per platform, fast reset.
