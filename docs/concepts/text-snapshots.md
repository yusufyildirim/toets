---
description: Text snapshots are focus-aware YAML views of the screen - deterministic, cheap for agents to read and comparable across platforms. Used as assertions and as failure context.
---

# Text snapshots

A **text snapshot** is a YAML rendering of the screen or one element: test IDs, text and state, with the focused element marked. It is deterministic and comparable across platforms, so it serves three purposes:

- **Failure context.** Every failure dump includes one; an agent reads it instead of a screenshot.
- **Exploration.** `app.snapshot()` (and the MCP server's `snapshot` tool) shows what is on screen and what is focusable.
- **Assertions.** Compare a region against a stored snapshot to lock down structure.

```yaml nocheck
- screen "home-screen":
    - list "rail-0":
        - item "rail-0-card-0": Big Buck Bunny
        - item "rail-0-card-1" [focused]: Sintel
        - item "rail-0-card-2": Tears of Steel
```

The format above is illustrative; see [`@dpad-tv/core`](../reference/core.md) for the exact format.

```ts
import { test, expect } from '@dpad-tv/test';

test('home rail structure is stable', async ({ app }) => {
  await app.launch();
  await expect(app.getByTestId('rail-0')).toMatchTextSnapshot();
});
```

## Traps

- **Snapshot a region, not the screen.** Whole-screen snapshots break on unrelated changes. Pick the element whose structure the test is about.
- **Mock the data first.** A snapshot of live content changes with the content. Use [network mocking](./network-mocking.md).
- **One snapshot can serve all platforms** when the app uses the same test IDs everywhere. Where platforms legitimately differ, the difference shows in the diff instead of hiding.
