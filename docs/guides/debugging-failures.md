---
description: Read the error, the failure dump and the report artifacts first; reproduce narrowly; fix the cause, not the timeout. Includes a symptom table.
---

# Debugging failures

dpad failures are meant to explain themselves. Read what they say before changing the test.

## 1. Read the failure

- **The error.** A `DpadError` has a code, a message, a `Hint:` with the likely cause and fix, and a `Docs:` page.
- **The failure dump**, attached to the failed test: focused element, a [text snapshot](../concepts/text-snapshots.md) of the surrounding tree, the last keys pressed, a screenshot, recent logs and requests.
- **The report.** `npx playwright show-report` lists every action as a step, with a screenshot and text snapshot per step. Per test: device logs, network log (HAR) and video. Web runs also have a full Playwright trace.

## 2. Reproduce narrowly

```sh
npx playwright test e2e/home.spec.ts:12 --project=android-tv --retries=0
npx playwright test e2e/home.spec.ts --project=web --ui
npx playwright test e2e/home.spec.ts --repeat-each=10   # is it flaky?
```

To look at the live app with the same primitives, use the [MCP server](../reference/mcp.md): launch, press, snapshot.

## 3. Match the symptom

| Symptom                                         | Look at                                                                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Element not found on one platform               | The text snapshot: is the test ID there? See the test ID mapping in [Locators](../concepts/locators-and-assertions.md).     |
| Focus on the wrong element                      | The step screenshots and last keys. An overlay or a different focus engine rule on that platform.                           |
| `navigateTo` says unreachable                   | The recorded path. The target may not be focusable, or is behind a focus trap.                                              |
| Timed out, busy resource named                  | The app never went idle: a poller, animation or player. Exclude the noise in the SDK.                                       |
| Unsupported key                                 | The platform lacks it. Declare `requires`, or configure an override. See [Remote and keys](../concepts/remote-and-keys.md). |
| Negative assertion passes, then the bug appears | It passed too early. Anchor it on a positive assertion. See [Idle](../concepts/idle.md).                                    |
| Passes on web, fails on a device                | Compare text snapshots across platforms; check device logs for app errors.                                                  |
| Launch fails                                    | Driver and device logs; the `app` config for that platform; see [Platforms](../platforms/web.md).                           |

## Traps

- **Do not raise the timeout** unless the operation is legitimately slow. Most timeouts are wrong state, not slowness.
- **Do not add sleeps or retries** to make a flaky test pass. Find what the test raced against.
- **Do not weaken the assertion** to match buggy behavior. If the app is wrong, the test should keep failing; report the bug.
- **Check the app first** when a test that used to pass fails everywhere at once.
