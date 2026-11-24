# toets - Vision

> Write one E2E test. Run it on every TV platform. Trust that it tests the same thing everywhere.

Status: v1 built on web, Android TV / Fire TV and tvOS; not yet published. This file holds goals, locked decisions and the roadmap. How things work lives in the [docs](./docs/index.md); do not restate it here. Update this file when a decision changes.

## Why

TV apps ship to many platforms at once: web-based TV OSes (Tizen, webOS, Vizio, ...), Android TV / Fire TV and tvOS. E2E tooling is fragmented and designed around other paradigms:

- Playwright has the best tooling (UI mode, trace viewer, codegen, reporters) but is web-only.
- Appium / WebdriverIO cover native but with weaker DX, slow round trips and no TV semantics.
- Every tool assumes pointer/touch. TV apps are driven by a **focus engine and a remote**. Nobody treats focus, D-pad navigation, remote keys, media playback or platform lifecycle as first-class.

toets is a **glue layer**, not a reinvention: a small, opinionated, TV-semantic API on top of industry-standard tools, with one runner, one mental model and platform parity enforced by the framework instead of by convention. Building our own lower-level drivers is allowed later, where performance demands it.

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
| 7   | **Device orchestration is built in.** toets boots, snapshots, leases and resets emulators/simulators, one device per worker.                                                                                                                                                                                                          |
| 8   | **CI: documentation only.** Agent-friendly setup recipes (Linux + KVM for Android, macOS for tvOS, caching). No shipped actions/workflows.                                                                                                                                                                                            |
| 9   | **Monorepo, scoped packages, ESM-only, latest Node LTS.** App-specific concerns (app IDs, launch/readiness flows) live in user config and fixtures, never in toets.                                                                                                                                                                   |
| 10  | **MIT licensed.**                                                                                                                                                                                                                                                                                                                     |
| 11  | **API breakage is acceptable** at this stage. Prior internal APIs are inspiration, not a contract.                                                                                                                                                                                                                                    |
| 12  | **Documentation is first-class, as important as the code**, agents being the primary audience. Concise, principle-based, never micro-managing. Ships with the packages, version-matched. See [Documentation](#documentation).                                                                                                         |
| 13  | **npm scope `@toets`.** Brand "toets". All packages are versioned together. Main package `@toets/test`.                                                                                                                                                                                                                               |
| 14  | **One `app` fixture.** Tests receive `{ app }`: the app under test on the current target (like Playwright's `page`). Page objects take `app`. Serial blocks share one `app` instance.                                                                                                                                                 |
| 15  | **SDK protocol:** JSON-RPC 2.0 over WebSocket, app connects to the host. Semver handshake announcing domains; domains extend driver capabilities. Single launch payload (SDK URL, one-time token, mock URL). SDK inert without a valid payload, excluded from production builds. Versioned spec + conformance suite.                  |
| 16  | **Idle is an accelerator, never a gate.** Idle = no tracked work (network, animations, short timers < ~1.5s, focus/navigation transitions) for ~100ms. Custom busy via `markBusy()`, noise exclusion supported. Assertions always retry with timeout; when never idle, fall back to polling and name the busy resource in the report. |
| 17  | **Semantic keys, honest mapping.** Drivers map only what hardware has; the rest is capability-gated. `PLAY`, `PAUSE` and `PLAY_PAUSE` are distinct. App-level key overrides in config (e.g. tvOS `FAST_FORWARD` = hold right), flagged in reports. No synthetic key injection via SDK (would bypass native focus engines).            |
| 18  | **v1 reporting uses Playwright primitives:** each action is a `test.step`; per-step screenshot (configurable) and text snapshot; per-test device logs, HAR, video, failure dump as attachments. Web keeps full Playwright traces.                                                                                                     |
| 19  | **Tooling:** develop on Node 26 LTS, support Node >= 24; pnpm workspaces; strict TypeScript 6 (move to the native TS 7 compiler once typescript-eslint supports it), ESM-only; tsdown builds; Vitest unit tests; Changesets; VitePress docs + llms.txt; ESLint + Prettier.                                                            |
| 20  | **Matchers live in the core**, over driver snapshots and auto-retry, never per platform. Drivers declare capabilities; the core skips (with a reason, in the parity matrix) or refuses what a platform can not do.                                                                                                                    |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ Authoring API (@toets/test): test · app · expect · Key     │
├──────────────────────────────────────────────────────────────┤
│ Runner: Playwright Test (projects = platform matrix)         │
├──────────────────────────────────────────────────────────────┤
│ Core (@toets/core): locators, matchers, focus, remote,     │
│ idle, text snapshots, failure dumps, capabilities            │
├───────────────┬──────────────────┬───────────────────────────┤
│ driver-web    │ driver-android-tv│ driver-tvos               │
│ (Playwright)  │ (Appium UIA2)    │ (Appium XCUITest)         │
├───────────────┴──────────────────┴───────────────────────────┤
│ Optional in-app SDK (protocol, sdk, sdk-react-native)        │
├──────────────────────────────────────────────────────────────┤
│ Infra: device providers · mock (MSW) · mcp · eslint-plugin   │
└──────────────────────────────────────────────────────────────┘
```

The details are in the docs: [concepts](./docs/concepts/locators-and-assertions.md), [platforms](./docs/platforms/web.md) and each package's `docs/` folder.

## Documentation

Agents write most toets tests, so docs are designed for agents first and humans second. The bar: an agent with no prior context can set up toets, write a correct cross-platform test and debug a failure using only what toets ships.

- **Concise.** Say it once, in the fewest words that stay unambiguous. No marketing, no filler.
- **Principles over procedures.** Explain what a concept is, why it exists and its constraints. Prescribe steps only where order truly matters (setup).
- **One concept per page**, with one minimal, real example.
- **State the TV-specific trap.** Where web or mobile intuition is wrong on TV (no click, focus-first, negative assertions), say so explicitly.
- **Examples are tested**, in docs and skills, so they can not rot. **Same PR:** a public API change ships with its docs and skill changes.
- **Skills stay short** (under 150 lines) and link to pages instead of inlining them.
- **Dogfood with agents.** Periodically give a fresh agent only the shipped docs and a task. Every stumble is a docs bug.

The mechanics (site, checks, markers) are in [docs/README.md](./docs/README.md).

## Roadmap

### Next: first release

- Publish `0.1.0` under `@toets`: Changesets and the release workflow are set up (see [RELEASING.md](./RELEASING.md)).
- First CI run on GitHub (the workflow exists but has never run).

### Known gaps in v1

- No `tvos-blackbox` project in the example app: XCUITest flattens the tree, so its page objects need rework.
- The web SDK claims `focus.graph` without direction data.
- The failure dump is attached twice, and its capabilities line is noisy.
- The ESLint plugin, the MCP server and `toets.steps` have not been dogfooded on a real project.

### Later

- **Legacy web lane.** Old Chromium versions matching TV engines (e.g. Tizen 3.0 = Chromium 47, old webOS = Chromium 38). Approach: a driver using a minimal, long-stable CDP subset (`Runtime.evaluate`, `Input.dispatchKeyEvent`, `Page.navigate/reload`, `Page.captureScreenshot`) plus an ES5 in-page agent; host-side polling (no `awaitPromise` on old engines); per-version Docker images with Xvfb; Chromium builds with proprietary codecs (open-source builds lack H.264/AAC). Same driver can later attach to Tizen/webOS emulators and devices, which expose CDP through their inspectors (prior art: HeadSpin's Appium Tizen/webOS drivers). Pairs with Tizen/webOS platform API shims.
- **Cloud service.** Hosted old-engine browsers + TV platform shims, reachable through the same CDP endpoint.
- **Real devices.** Android TV / Fire TV over adb, Apple TV via devicectl, Tizen/webOS via sdb/ares.
- **Platform shims.** Fire TV specifics on Android TV emulators (Amazon IAP, ADM, ...).
- **Focus tooling.** Focus-map snapshots (a screen's focus topology, diffed across builds and platforms) and a focus crawler (dead ends, traps, unreachable elements).
- **Playwright trace viewer for native.** Serialize the SDK tree as a pseudo-DOM over screenshots into trace archives (format is internal and unstable; may require a fork of the viewer).
- **Own native drivers** where profiling justifies it (likely a thin on-device server replacing Appium on Android first).
- **Role/label selectors** on top of the SDK tree.
- **Network:** HAR replay, and a black-box proxy mode for apps that can not cooperate.
- **Visual:** integrations with hosted visual review services rather than building one.
- **Vega (Fire TV OS).**
- **TV-aware codegen / recorder.**

## Lessons from the predecessor

toets grows out of an internal cross-platform TV E2E layer (Playwright on web, Jest + WebdriverIO + Appium on Android).

**Keep:** focus and remote as primitives; a small, opaque, restricted API; cooperative proxy mocking with MSW; page objects with lint-enforced rules; a fast web-first iteration loop.

**Fixed in toets:**

- Two runners caused semantic drift (retries, timeouts, serial mode, reporters, traces): one runner (decision 1).
- Per-platform matchers drifted in meaning and timeouts: core matchers (decision 20).
- App-specific launch logic leaked into the library: user-owned fixtures and SDK state launch (decision 9).
- Raw keycodes lived in user code: semantic keys (decision 17).
- Missing domains forced escape hatches (casting to the underlying locator, shelling out to `adb dumpsys` for media): SDK domains and typed, explicit escape hatches.
- Single global native session, hand-rolled emulator port math, serial-only native runs: device providers, one device per worker (decision 7).

## Open questions

None currently. Add new ones here.
