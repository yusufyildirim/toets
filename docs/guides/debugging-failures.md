---
description: Read the error, the failure dump and the report artifacts first; reproduce narrowly; fix the cause, not the timeout. Includes a symptom table.
---

# Debugging failures

toets failures are meant to explain themselves. Read what they say before changing the test.

## 1. Read the failure

- **The error.** A thrown error reads `ToetsError: [CODE] what happened`, then `Hint:` (likely cause and fix) and `Docs:` (the page, with its offline path). Every code is listed in the [error code index](../reference/core/docs/errors.md). A failed assertion shows the locator, expected and received state, what was focused and whether the app was idle.
- **The failure dump** (`toets-failure.md`, with `toets-screenshot.png`), in the failed test's `test-results/` folder and attached to the report: platform and capabilities, the focused element, a [text snapshot](../concepts/text-snapshots.md) of the screen, the last keys pressed, what kept the app busy, recent logs and requests. See [failure dumps](../reference/core/docs/failure-dumps.md).
- **The report.** `npx playwright show-report` lists every action as a step (`press RIGHT`, `pressUntilFocused RIGHT getByTestId('card')`). Per test: `toets-logs` and, with mocking on, `toets-network.har`. Per-step screenshots and snapshots (`toets.steps`) and video (`toets.video`) are off by default; turn them on while debugging. Web runs also record Playwright traces (`--trace on`).

## 2. Reproduce narrowly

```sh
npx playwright test e2e/home.spec.ts:12 --project=android-tv --retries=0
npx playwright test e2e/home.spec.ts --project=web --ui
npx playwright test e2e/home.spec.ts --repeat-each=10   # is it flaky?
```

To look at the live app with the same primitives, use the [MCP server](../reference/mcp.md): launch, press, snapshot.

## 3. Match the symptom

| Symptom                                          | Look at                                                                                                                      |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Element not found on one platform                | The text snapshot: is the test ID there? See the test ID mapping in [Locators](../concepts/locators-and-assertions.md).      |
| Focus on the wrong element                       | The step screenshots and last keys. An overlay or a different focus engine rule on that platform.                            |
| `FOCUS_STUCK`, `FOCUS_LOOP`, `FOCUS_UNREACHABLE` | Where focus went, in the message. Stuck: end of a row, a trap, a disabled target. Loop: the target is not in that direction. |
| Timed out, busy resource named                   | The app never went idle: a poller, animation or player. Exclude the noise in the SDK.                                        |
| `KEY_UNSUPPORTED`                                | The platform lacks it. Declare `requires`, or configure an override. See [Remote and keys](../concepts/remote-and-keys.md).  |
| Negative assertion passes, then the bug appears  | It passed too early. Anchor it on a positive assertion. See [Idle](../concepts/idle.md).                                     |
| Passes on web, fails on a device                 | Compare text snapshots across platforms; check device logs for app errors.                                                   |
| Launch fails                                     | Driver and device logs; the `app` config for that platform; see [Platforms](../platforms/web.md).                            |

## Traps

- **Do not raise the timeout** unless the operation is legitimately slow. Most timeouts are wrong state, not slowness.
- **Do not add sleeps or retries** to make a flaky test pass. Find what the test raced against.
- **Do not weaken the assertion** to match buggy behavior. If the app is wrong, the test should keep failing; report the bug.
- **Check the app first** when a test that used to pass fails everywhere at once.
