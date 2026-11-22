---
name: dpad-debug-failures
description: Investigate failing, flaky or timing-out dpad (@dpad-tv/test) TV tests on web, Android TV / Fire TV or tvOS. Use when a dpad test fails, a DpadError appears, a test passes on one platform but not another, or a test is flaky. For writing new tests use dpad-write-tests.
---

# Debugging dpad failures

dpad failures are designed to explain themselves: errors carry a hint and a docs slug, and every failed test has a failure dump. Read before changing anything. The full guide is `guides/debugging-failures`.

Docs are referenced by slug, for example `concepts/idle`: the docs site page `/<slug>`, also served as markdown at `/<slug>.md`. Package reference pages ship offline in `node_modules/@dpad-tv/<package>/docs/`.

## Workflow

1. **Read the error.** A `DpadError` prints `[code]`, the message, `Hint:` (likely cause and fix) and `Docs:` (a slug). Follow the hint first.
2. **Read the failure dump** attached to the test: focused element, text snapshot of the surrounding tree, last keys pressed, screenshot, recent logs and requests. The text snapshot shows which test IDs exist and what is focused.
3. **Read the steps** in the report (`npx playwright show-report`, or the attachments in `test-results/`): every action is a step with a screenshot and text snapshot. Find the first step where reality diverged from intent; that is usually earlier than the failing line.
4. **Reproduce narrowly**, without retries:

   ```sh
   npx playwright test e2e/home.spec.ts:12 --project=android-tv --retries=0
   npx playwright test e2e/home.spec.ts --repeat-each=10   # flaky?
   ```

5. **Explore live if needed** with the dpad MCP server (launch, press, snapshot): the same primitives as tests.
6. **Fix the cause**, then rerun on every platform.

## Symptoms

| Symptom                                    | Likely cause and fix                                                                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Element not found on one platform          | Test ID missing or not mapped there. Check the text snapshot; add the ID in the app. (`concepts/locators-and-assertions`)               |
| Focus on the wrong element                 | Overlay, focus memory or that platform's focus engine rules. Assert focus after each step to find where it diverged. (`concepts/focus`) |
| `navigateTo` unreachable                   | Target not focusable or behind a focus trap. Read the recorded path. Possibly an app bug.                                               |
| Timeout naming a busy resource             | App never idle (poller, animation, player). Exclude the noise in the SDK config, or fix the app. (`concepts/idle`)                      |
| Unsupported key / capability error         | The remote lacks the key. Add `requires`, or a key override if the app has a gesture for it. (`concepts/remote-and-keys`)               |
| Negative assertion passes, bug still there | It ran before the state existed. Anchor it on a positive assertion first. (`concepts/idle`)                                             |
| Passes on web, fails on device             | Slower device, stricter focus engine, missing key. Compare text snapshots between platforms. (`platforms/tvos`, `platforms/android-tv`) |
| Mock not applied                           | Handler added after `launch()`, or matched on host instead of path. (`concepts/network-mocking`)                                        |
| Launch or device errors                    | Read driver and device logs; check the platform's `app` config and host requirements. (`platforms/web`)                                 |
| Fails in CI only                           | Missing KVM, cold boots, uncached WebDriverAgent, fewer CPUs. (`ci/android`, `ci/tvos`)                                                 |

## Never

- Add sleeps or `waitForTimeout`.
- Raise a timeout without evidence the operation is legitimately slow.
- Add retries to make a flaky test pass.
- Weaken or delete an assertion so a buggy app passes. If the app is wrong, report it and leave the test failing (or mark it with `test.fail()` and a reason, if the maintainers agree).
- Switch to `app.platformOnly` to work around a gap.

## Report back

State the root cause, the evidence (dump, step, log line), the fix, and the commands you ran to verify on which platforms.
