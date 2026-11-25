---
name: toets-debug-failures
description: Investigate failing, flaky or timing-out toets (@toets/test) TV tests on web, Android TV / Fire TV or tvOS. Use when a toets test fails, a ToetsError appears, a test passes on one platform but not another, or a test is flaky. For writing new tests use toets-write-tests.
---

# Debugging toets failures

toets failures are designed to explain themselves: errors carry a hint and a docs slug, and every failed test has a failure dump. Read before changing anything. The full guide is `guides/debugging-failures`.

Docs are referenced by slug, for example `concepts/idle`: the docs site page `/<slug>`, also served as markdown at `/<slug>.md` (until the site is hosted: under `docs/` in the toets repository). Package reference pages (`reference/<package>/docs/<page>`) ship offline in each installed package's `docs/`; errors print the exact path.

## Workflow

1. **Read the error.** A thrown error prints `ToetsError: [CODE] message`, `Hint:` (likely cause and fix) and `Docs:` (a slug, plus its offline path in `node_modules`). Follow the hint first. Any code: `reference/core/docs/errors`. A failed assertion prints expected and received state, the focused element and idle status.
2. **Read the failure dump** (`test-results/<test>/toets-failure.md`, path printed with the failure): focused element, text snapshot of the screen, last keys pressed, busy resources, recent logs and requests; `toets-screenshot` next to it. The text snapshot shows which test IDs exist and what is focused. (`reference/core/docs/failure-dumps`)
3. **Read the steps** in the report (`npx playwright show-report`): every action is a step. For a screenshot and text snapshot after every step, rerun with `toets: { steps: { screenshot: true, snapshot: true } }`. Find the first step where reality diverged from intent; that is usually earlier than the failing line.
4. **Reproduce narrowly**, without retries:

   ```sh
   npx playwright test e2e/home.spec.ts:12 --project=android-tv --retries=0
   npx playwright test e2e/home.spec.ts --repeat-each=10   # flaky?
   ```

5. **Explore live if needed** with the toets MCP server (launch, press, snapshot): the same primitives as tests.
6. **Fix the cause**, then rerun on every platform.

## Symptoms

| Symptom                                          | Likely cause and fix                                                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Element not found on one platform                | Test ID missing or not mapped there. Check the text snapshot; add the ID in the app. (`concepts/locators-and-assertions`)                             |
| Focus on the wrong element                       | Overlay, focus memory or that platform's focus engine rules. Assert focus after each step to find where it diverged. (`concepts/focus`)               |
| `FOCUS_STUCK`, `FOCUS_LOOP`, `FOCUS_UNREACHABLE` | The message lists where focus went. Stuck: end of a row, a trap or a disabled target. Loop: the target is not in that direction. Possibly an app bug. |
| Timeout naming a busy resource                   | App never idle (poller, animation, player). Exclude the noise in the SDK config, or fix the app. (`concepts/idle`)                                    |
| Unsupported key / capability error               | The remote lacks the key. Add `requires`, or a key override if the app has a gesture for it. (`concepts/remote-and-keys`)                             |
| Negative assertion passes, bug still there       | It ran before the state existed. Anchor it on a positive assertion first. (`concepts/idle`)                                                           |
| Passes on web, fails on device                   | Slower device, stricter focus engine, missing key. Compare text snapshots between platforms. (`platforms/tvos`, `platforms/android-tv`)               |
| Mock not applied                                 | `toets.mock` off, handler added after `launch()`, or the app never routed the request: check `app.network.requests()`. (`concepts/network-mocking`)   |
| Launch or device errors                          | Read driver and device logs; check the platform's `app` config and host requirements. (`platforms/web`)                                               |
| Fails in CI only                                 | Missing KVM, cold boots, uncached WebDriverAgent, fewer CPUs. (`ci/android`, `ci/tvos`)                                                               |

## Never

- Add sleeps or `waitForTimeout`.
- Raise a timeout without evidence the operation is legitimately slow.
- Add retries to make a flaky test pass.
- Weaken or delete an assertion so a buggy app passes. If the app is wrong, report it and leave the test failing (or mark it with `test.fail()` and a reason, if the maintainers agree).
- Switch to `app.platformOnly` to work around a gap.

## Report back

State the root cause, the evidence (dump, step, log line), the fix, and the commands you ran to verify on which platforms.
