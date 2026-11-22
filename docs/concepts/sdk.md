---
description: The optional in-app SDK reports the app's own tree, focus graph, idle state and media state over an open protocol. It speeds tests up and adds capabilities; it is never required.
---

# The in-app SDK

dpad works **black-box**: the first test needs no app changes. The optional **SDK** is a small library inside the app that talks to the test host and reports what the app itself knows. It makes tests faster and more reliable, and adds capabilities a black-box driver can not offer.

| Domain  | Adds                                                    | Capability    |
| ------- | ------------------------------------------------------- | ------------- |
| `tree`  | uniform element tree, free of accessibility-tree quirks |               |
| `focus` | the app's real focus and focus graph                    | `focus.graph` |
| `sync`  | idle signal, busy resources                             | `sync.idle`   |
| `media` | player state, position, duration, errors                | `media.state` |
| `state` | launch into a named state, feature flags                | `app.state`   |
| `logs`  | console output and unhandled errors on the test result  | `logs`        |

## How it connects

The test host passes a launch payload to the app (SDK host URL, one-time token, mock server URL). The SDK reads it, connects to the host over WebSocket, and announces the domains it implements. Without a valid payload the SDK does nothing: it never opens a connection in normal use. Exclude it from production builds anyway.

Packages: [`@dpad-tv/sdk`](../reference/sdk.md) (framework-neutral core and web adapter) and [`@dpad-tv/sdk-react-native`](../reference/sdk-react-native.md). Any framework can implement the [protocol](../reference/protocol.md); a conformance suite verifies it.

## Named states

With `state`, a test starts where it needs to be instead of clicking through onboarding:

```ts
import { test, expect } from '@dpad-tv/test';

test('resumes from the continue-watching rail', { requires: ['app.state'] }, async ({ app }) => {
  await app.launch({ state: 'signed-in-with-history' });
  await expect(app.getByTestId('rail-continue-watching')).toBeVisible();
});
```

The app defines what each state name means; dpad only delivers the name.

## Traps

- **The SDK never sends input.** Keys always go through the platform, so the native focus engine is exercised. The SDK only observes and prepares state.
- **Keep black-box tests passing.** A test that needs the SDK says so with `requires`. Do not make the whole suite depend on it by accident.
- **Do not ship it.** Guard the SDK behind a debug or test build flag so production bundles exclude it.
