# dpad - Vision

> Write one E2E test. Run it on every TV platform. Trust that it tests the same thing everywhere.

Status: v1 in development. This document captures goals, locked decisions, architecture direction and phasing. Update it when a decision changes. Implementation plan: [PLAN.md](./PLAN.md).

## Why

TV apps ship to many platforms at once: web-based TV OSes (Tizen, webOS, Vizio, ...), Android TV / Fire TV and tvOS. E2E tooling is fragmented and designed around other paradigms:

- Playwright has the best tooling (UI mode, trace viewer, codegen, reporters) but is web-only.
- Appium / WebdriverIO cover native but with weaker DX, slow round trips and no TV semantics.
- Every tool assumes pointer/touch. TV apps are driven by a **focus engine and a remote**. Nobody treats focus, D-pad navigation, remote keys, media playback or platform lifecycle as first-class.

dpad is a **glue layer**, not a reinvention: a small, opinionated, TV-semantic API on top of industry-standard tools, with one runner, one mental model and platform parity enforced by the framework instead of by convention. Building our own lower-level drivers is allowed later, where performance demands it.

## Principles

1. **Top-notch documentation, alongside top-notch code.** Docs, especially for agents, get the same care as the code. A feature is done when both the code and its docs (concise page, working example, clear errors) are.
2. **TV semantics first.** Focus and remote are the primitives. There is no `click`.
3. **Write once, same meaning everywhere.** A matcher means the same thing on every platform, or the platform declares it unsupported. No silent drift.
4. **Small, restricted API.** Fewer ways to write a bad test. Opaque types, no leaky escape hatches into underlying tools.
5. **Agent-first.** Most tests will be written and maintained by agents. Optimize for discoverability, deterministic text output and self-explaining failures.
6. **Standing on giants.** Reuse Playwright, Appium, MSW etc. Own only the glue, until owning more is clearly better.
7. **Framework-neutral core, framework adapters where they pay off.** The core works with any app. Framework-specific adapters (React Native first) exist only when they offer a considerably better experience.
8. **Zero app changes to start.** The first test must work black-box. The in-app SDK is an accelerator, not a requirement.
9. **Quality over development cost.** Prefer robust, simple, maintainable designs even when they take longer to build.

## Locked decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Playwright Test is the runner for all platforms.** Platforms are Playwright projects. No Jest, no file-extension platform splitting.                                                                                                                                                                                                |
| 2   | **Framework-neutral core** with an open in-app protocol. Framework-specific adapters only where the gain is considerable. React Native (incl. react-native-web) is the first adapter.                                                                                                                                                 |
| 3   | **v1 platforms, all equal priority:** modern web (Chromium), Android TV / Fire TV, tvOS.                                                                                                                                                                                                                                              |
| 4   | **v1 targets emulators, simulators and browsers only.** No real devices yet.                                                                                                                                                                                                                                                          |
| 5   | **Black-box parity for the core API.** Locators, focus, remote, screenshots, mocking work without the SDK. The SDK adds speed, idle-sync reliability and extra domains (media, app state, focus graph).                                                                                                                               |
| 6   | **Selectors in v1: test ID + text.** Role/label come later, once the SDK tree gives a uniform model.                                                                                                                                                                                                                                  |
| 7   | **Device orchestration is built in.** dpad boots, snapshots, leases and resets emulators/simulators, one device per worker.                                                                                                                                                                                                           |
| 8   | **CI: documentation only.** Agent-friendly setup recipes (Linux + KVM for Android, macOS for tvOS, caching). No shipped actions/workflows.                                                                                                                                                                                            |
| 9   | **Monorepo, scoped packages, ESM-only, latest Node LTS.** App-specific concerns (app IDs, launch/readiness flows) live in user config and fixtures, never in dpad.                                                                                                                                                                    |
| 10  | **MIT licensed.**                                                                                                                                                                                                                                                                                                                     |
| 11  | **API breakage is acceptable** at this stage. Prior internal APIs are inspiration, not a contract.                                                                                                                                                                                                                                    |
| 12  | **Documentation is first-class, as important as the code**, agents being the primary audience. Concise, principle-based, never micro-managing. Ships with the packages, version-matched. See [Documentation](#documentation).                                                                                                         |
| 13  | **npm scope `@dpad-tv`.** Brand stays "dpad". Unscoped `dpad` is blocked by npm's similarity check and `@dpad` is taken. Main package `@dpad-tv/test`.                                                                                                                                                                                |
| 14  | **One `app` fixture.** Tests receive `{ app }`: the app under test on the current target (like Playwright's `page`). Page objects take `app`. Serial blocks share one `app` instance.                                                                                                                                                 |
| 15  | **SDK protocol:** JSON-RPC 2.0 over WebSocket, app connects to the host. Semver handshake announcing domains; domains extend driver capabilities. Single launch payload (SDK URL, one-time token, mock URL). SDK inert without a valid payload, excluded from production builds. Versioned spec + conformance suite.                  |
| 16  | **Idle is an accelerator, never a gate.** Idle = no tracked work (network, animations, short timers < ~1.5s, focus/navigation transitions) for ~100ms. Custom busy via `markBusy()`, noise exclusion supported. Assertions always retry with timeout; when never idle, fall back to polling and name the busy resource in the report. |
| 17  | **Semantic keys, honest mapping.** Drivers map only what hardware has; the rest is capability-gated. `PLAY`, `PAUSE` and `PLAY_PAUSE` are distinct. App-level key overrides in config (e.g. tvOS `FAST_FORWARD` = hold right), flagged in reports. No synthetic key injection via SDK (would bypass native focus engines).            |
| 18  | **v1 reporting uses Playwright primitives:** each action is a `test.step`; per-step screenshot (configurable) and text snapshot; per-test device logs, HAR, video, failure dump as attachments. Web keeps full Playwright traces.                                                                                                     |
| 19  | **Tooling:** develop on Node 26 LTS, support Node >= 24; pnpm workspaces; strict TypeScript 6 (move to the native TS 7 compiler once typescript-eslint supports it), ESM-only; tsdown builds; Vitest unit tests; Changesets; VitePress docs + llms.txt; ESLint + Prettier.                                                            |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Authoring API (TV-semantic, tiny, stable)                    │
│ test · app · remote · focus · locators · expect              │
│ network · media · platform                                   │
├──────────────────────────────────────────────────────────────┤
│ Runner: Playwright Test (projects = platform matrix)         │
│ fixtures · retries · sharding · reporters · UI mode          │
├──────────────────────────────────────────────────────────────┤
│ Driver interface + capability flags                          │
├───────────────┬──────────────────┬───────────────────────────┤
│ web           │ android-tv       │ tvos                      │
│ (Playwright)  │ (Appium UIA2,    │ (Appium XCUITest)         │
│               │  own server later)│                          │
├───────────────┴──────────────────┴───────────────────────────┤
│ Optional in-app SDK (open protocol over WebSocket)           │
│ tree · focus graph · idle signal · media · state · logs      │
├──────────────────────────────────────────────────────────────┤
│ Infra: device pool · mock server · platform shims · artifacts│
└──────────────────────────────────────────────────────────────┘
```

### Authoring API (illustrative, not final)

```ts
import { test, expect, Key } from '@dpad-tv/test';

test('pauses and resumes playback from the remote', async ({ app }) => {
  await app.launch({ state: 'home' });
  await expect(app.media).toBePlaying();

  await app.remote.press(Key.PLAY_PAUSE);
  await expect(app.media).toBePaused();

  await app.focus.navigateTo(app.getByTestId('like_button'));
  await expect(app.getByTestId('like_button')).toBeFocused();
});

test('color keys open the guide', { requires: ['key.color'] }, async ({ app }) => {
  // auto-skipped with a reason on platforms without color keys
});
```

Config sketch:

```ts
import { defineConfig, platforms } from '@dpad-tv/test';

export default defineConfig({
  app: {
    web: { url: 'http://localhost:3000' },
    androidTV: { apk: './artifacts/app.apk', package: 'com.example.tv' },
    tvOS: { app: './artifacts/App.app', bundleId: 'com.example.tv' },
  },
  projects: [
    platforms.web(),
    platforms.androidTV({ avd: 'tv_1080p', api: 34 }),
    platforms.tvOS({ runtime: '18' }),
  ],
});
```

### Runner

- Playwright Test with a dpad `app` fixture per platform project.
- Gains on every platform: HTML report, UI mode, VS Code extension, `--project`, sharding, retries, `test.step` grouping, attachments (screenshots, video, device logs, network log).
- Serial flows use Playwright's serial mode semantics consistently on all platforms.

### Driver interface (sketch)

```ts
interface Driver {
  readonly platform: Platform;
  readonly capabilities: ReadonlySet<Capability>;

  launch(opts: LaunchOptions): Promise<void>;
  terminate(): Promise<void>;
  reset(): Promise<void>; // clear data / restore snapshot

  query(selector: Selector): Promise<ElementRef[]>;
  describe(el: ElementRef): Promise<ElementSnapshot>; // bounds, text, testId, visible, focused, ...
  focused(): Promise<ElementSnapshot | null>;
  tree(): Promise<UITree>;

  press(key: Key, opts?: { holdMs?: number }): Promise<void>;
  screenshot(opts?: { element?: ElementRef }): Promise<Buffer>;
  logs(): AsyncIterable<LogEntry>;
}
```

- Matchers are implemented **once** in the core on top of `ElementSnapshot` + auto-retry, not per platform. This is how parity is enforced.
- Drivers report capabilities; the core refuses or skips (with reason) what a platform cannot do.
- Escape hatch for platform-specific code is explicit and typed (`app.platformOnly('web', page => ...)`), visible in reports, and lint-discouraged.

### Capabilities (initial set)

`key.back`, `key.home`, `key.menu`, `key.info`, `key.media.toggle`, `key.media.discrete`, `key.media.seek`, `key.media.track`, `key.color`, `key.numeric`, `key.channel`, `key.longpress`, `focus.graph`, `sync.idle`, `media.state`, `app.state`, `network.mock`, `screenshot.element`, `platform.events`.

Tests declare `requires`; the report shows a **parity matrix** (which test ran where, which was skipped and why).

### In-app SDK and protocol

Optional, framework-neutral protocol over WebSocket (host <-> app; `adb reverse` on Android, shared localhost on the tvOS simulator, direct on web). Domains:

- **tree**: uniform element tree with test IDs, text, bounds, visibility, focus. Removes platform accessibility-tree quirks.
- **focus**: current focus, focus graph (neighbors per direction), focus change events.
- **sync**: idle signal (pending network, animations, timers, JS queue). Assertions wait on idle instead of polling; negative assertions become fast.
- **media**: player state, position, duration, rate, errors. No OS-level scraping.
- **state**: launch into a named state, feature flags, clock control, deep links. Replaces "launch, then click through onboarding" boilerplate.
- **logs / errors**: console, unhandled errors, attached to the test result.
- **metrics**: key press to focus change latency, startup time, dropped frames.

Adapters: React Native first (hooks into the app's spatial navigation / focus engine through a neutral focus-graph contract that other engines can implement).

### Focus

Focus is the moat.

- Matchers: `toBeFocused`, `toHaveFocusWithin`, focus path assertions.
- `focus.navigateTo(locator)`: path-finding over focus geometry or the SDK focus graph, using real remote presses; the chosen path is recorded in the trace/report.
- Focus-map snapshots: capture a screen's focus topology and diff it across builds and platforms.
- Focus crawler: explores a screen and reports dead ends, traps and unreachable elements.

### Remote

- Canonical semantic `Key` set: D-pad, SELECT, BACK, HOME, MENU, PLAY, PAUSE, PLAY_PAUSE, FF, RW, color keys, numeric, channel, info.
- Each driver owns its mapping (Android keycodes, tvOS `XCUIRemote` buttons, web key events). Unsupported keys are capability-gated.
- `press`, `longPress`, `repeat(key, n)`, `sequence([...])` with realistic timing.

### Network mocking

- MSW handlers executed in a host-side mock server; the app is pointed at it and unmatched requests are proxied upstream (cooperative proxy, no MITM certificates). Portable across all platforms.
- Tiny cross-platform helper for passing the mock base URL to the app (URL param / init script on web, intent extra on Android, launch arguments on tvOS).
- Additions: request assertions (`expect(app.network).toHaveRequested(...)`), HAR record/replay, injected latency and failures, per-test isolation.
- Later: black-box system-proxy mode for apps that cannot cooperate.

### Platform shims

Fake platform APIs and OS events so behavior that depends on the OS can be tested without the OS:

- Fire TV specifics on Android TV emulators (Amazon IAP, ADM, ...).
- Lifecycle and environment events from tests: `app.platform.emit('network-lost' | 'suspend' | 'resume')`.
- Web TV OS shims (Tizen, webOS) arrive with the legacy web phase.

### Device orchestration

- Device pool: boot, snapshot, install, lease one device per worker, reset between tests (snapshot restore / clear data), teardown.
- Android emulators (Android TV images) and tvOS simulators in v1.
- Fast reset is a first-class performance goal.

### Agent tooling

- **MCP server** on the same drivers: `press`, `snapshot`, `assert`, `launch`, so agents explore apps with exactly the primitives they write tests in.
- **Text screen snapshots** (YAML, like Playwright ARIA snapshots, focus-aware): cheap, deterministic, LLM-readable, comparable across platforms. Usable both as an assertion and as failure context.
- **Failure dumps**: focused element, surrounding tree, last N keys, screenshot, recent logs and requests.
- **Shipped ESLint plugin**: no `sleep`, page-object rules (no assertions except stability ones), no raw platform escape hatches.
- **Shipped AGENTS.md / skills** describing how to write good dpad tests.

### Visual

- Screenshot assertions with per-platform baselines, masking (video surfaces, clocks), stable diffing.
- Integrations with hosted visual review services rather than building one.

## Documentation

Agents write most dpad tests, so docs are designed for agents first and humans second. The bar: an agent with no prior context can set up dpad, write a correct cross-platform test and debug a failure using only what dpad ships.

### Style

- **Concise.** Say it once, in the fewest words that stay unambiguous. No marketing, no filler.
- **Principles over procedures.** Explain what a concept is, why it exists and its constraints. Trust the reader to apply it. Prescribe steps only where order truly matters (setup).
- **One concept per page.** Small pages that are cheap to load into context and easy to link.
- **Show, briefly.** One minimal, real example per concept beats paragraphs of prose.
- **State the TV-specific trap.** Where web or mobile intuition is wrong on TV (no click, focus-first, negative assertions), say so explicitly.

### Artifacts

| Artifact                                | Purpose                                                                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TSDoc on every public API               | First thing agents and IDEs see. Types and doc comments are part of the docs.                                                                                                                          |
| `docs/` shipped inside the npm packages | Offline, version-matched docs at `node_modules/<pkg>/docs`. Package README points there.                                                                                                               |
| `llms.txt` / `llms-full.txt`            | Index and full dump for the docs site.                                                                                                                                                                 |
| Agent skills (`SKILL.md`)               | A few task-level skills: **write tests**, **debug failures**, **set up a project** (incl. CI recipes), **migrate** (from Playwright / Appium / Detox / the predecessor). Installable with one command. |
| Errors as docs                          | Every error says what happened, the likely cause, the fix and a docs link. Failure dumps carry the context needed to act.                                                                              |
| MCP docs tool                           | The MCP server exposes docs search so agents exploring an app can look things up in place.                                                                                                             |
| CI recipes                              | Per-platform setup docs (Linux + KVM for Android, macOS for tvOS, caching), written for agents to adapt.                                                                                               |

### Rules

- **Examples are tested.** Code in docs and skills is type-checked and executed in CI so it can not rot.
- **Same PR.** A public API change without a matching docs/skill change fails CI.
- **Size budgets.** Skills stay short (roughly under 150 lines) and link to pages instead of inlining them.
- **Dogfood with agents.** Periodically give a fresh agent only the shipped docs and a task (set up, write, debug). Every stumble is a docs bug.

## v1 scope

- Packages (under `@dpad-tv/`): `core`, `test` (runner, main entry), `driver-web`, `driver-android-tv`, `driver-tvos`, `protocol`, `sdk` (in-app core + web adapter), `sdk-react-native`, `mock`, `mcp`, `eslint-plugin`.
- Example app (React Native, tvOS + Android TV + web) used to dogfood every platform.
- Playwright Test runner across web, Android TV / Fire TV emulators and tvOS simulators.
- Core API: test/hooks, locators (test ID, text), focus matchers, `navigateTo`, semantic remote, screenshots, mocking, capabilities + parity report.
- SDK: tree, focus graph, idle sync, media, state launch.
- Device pool for emulators/simulators.
- MCP server + text snapshots + failure dumps.
- Documentation set: TSDoc, shipped `docs/`, `llms.txt`, skills (write, debug, set up, migrate), CI recipes, tested examples.

## Later phases

- **Legacy web lane.** Old Chromium versions matching TV engines (e.g. Tizen 3.0 = Chromium 47, old webOS = Chromium 38). Approach: a driver using a minimal, long-stable CDP subset (`Runtime.evaluate`, `Input.dispatchKeyEvent`, `Page.navigate/reload`, `Page.captureScreenshot`) plus an ES5 in-page agent; host-side polling (no `awaitPromise` on old engines); per-version Docker images with Xvfb; Chromium builds with proprietary codecs (open-source builds lack H.264/AAC). Same driver can later attach to Tizen/webOS emulators and devices, which expose CDP through their inspectors (prior art: HeadSpin's Appium Tizen/webOS drivers). Pairs with Tizen/webOS platform API shims.
- **Cloud service.** Hosted old-engine browsers + TV platform shims, reachable through the same CDP endpoint.
- **Real devices.** Android TV / Fire TV over adb, Apple TV via devicectl, Tizen/webOS via sdb/ares.
- **Playwright trace viewer for native.** Serialize the SDK tree as a pseudo-DOM over screenshots into trace archives (format is internal and unstable; may require a fork of the viewer).
- **Own native drivers** where profiling justifies it (likely a thin on-device server replacing Appium on Android first).
- **Role/label selectors** on top of the SDK tree.
- **Black-box network proxy mode.**
- **Vega (Fire TV OS).**
- **TV-aware codegen / recorder.**

## Lessons from the predecessor

dpad grows out of an internal cross-platform TV E2E layer (Playwright on web, Jest + WebdriverIO + Appium on Android). Keep / fix:

**Keep**

- Focus and remote as primitives; focus-aware matchers.
- Small, opaque, restricted API.
- Cooperative proxy mocking with MSW.
- Page objects with lint-enforced rules.
- Web-first fast iteration loop.

**Fix**

- Two runners caused semantic drift (retries, timeouts, serial mode, reporters, traces). Solved by decision 1.
- Matchers implemented per platform drifted in meaning and timeouts. Solved by core-implemented matchers over snapshots.
- App-specific launch logic leaked into the library. Solved by user-owned launch/readiness fixtures and SDK state launch.
- Raw keycodes lived in user code. Solved by semantic keys + driver mapping.
- Missing domains forced escape hatches (casting to the underlying locator, shelling out to `adb dumpsys` for media). Solved by SDK domains and typed, explicit escape hatches.
- Single global native session, hand-rolled emulator port math, serial-only native runs. Solved by the device pool.

## Open questions

None currently. Add new ones here.
