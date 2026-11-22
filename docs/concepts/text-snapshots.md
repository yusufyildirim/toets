---
description: Text snapshots are focus-aware YAML views of the screen - deterministic, cheap for agents to read and comparable across platforms. Used as assertions and as failure context.
---

# Text snapshots

A **text snapshot** is a YAML rendering of the screen or one element: test IDs, text and state, with the focused element marked. It is deterministic and comparable across platforms, so it serves three purposes:

- **Failure context.** Every failure dump includes one; an agent reads it instead of a screenshot.
- **Exploration.** `app.snapshot()` (and the MCP server's `snapshot` tool) shows what is on screen and what is focusable.
- **Assertions.** Compare a region against a stored snapshot to lock down structure.

```yaml
- rail-0:
    - rail-0-card-0 "Big Buck Bunny"
    - rail-0-card-1 "Sintel" [focused]
- rail-1:
    - rail-1-card-0 "Tears of Steel"
```

One line per visible element: its test ID (else its text), its text in quotes and its state in brackets. Exact rules: [text snapshots reference](../reference/core/docs/text-snapshots.md).

```ts
import { test, expect } from '@dpad-tv/test';

test('home rail lists the mocked titles', async ({ app }) => {
  await app.launch();
  await expect(app.getByTestId('rail-0')).toMatchTextSnapshot(`
    - rail-0:
      - rail-0-card-0 "Big Buck Bunny" [focused]
      - rail-0-card-1 "Sintel"
  `);
});
```

With a string, the snapshot is compared inline (indentation ignored). Without one, it is compared to a baseline file per project, written (and failed) on the first run like any Playwright snapshot and updated with `--update-snapshots`.

## Traps

- **Snapshot a region, not the screen.** Whole-screen snapshots break on unrelated changes. Pick the element whose structure the test is about.
- **Nesting follows the tree.** Black-box native trees can flatten containers (a React Native `View` lists its children as its siblings), so a snapshot spanning them only has the same shape where the tree nests: declare `requires('tree.hierarchy')` (the DOM and the SDK tree), or snapshot an element that keeps its children everywhere.
- **Mock the data first.** A snapshot of live content changes with the content. Use [network mocking](./network-mocking.md).
- **Inline snapshots serve all platforms** when the app uses the same test IDs everywhere; where platforms legitimately differ, the diff shows it. Baseline files are per project, and Playwright's default path also includes the host OS (`-darwin`, `-linux`): set `snapshotPathTemplate` (for example `'{testDir}/__snapshots__/{testFilePath}/{arg}-{projectName}{ext}'`) so baselines written on a laptop match in CI.
