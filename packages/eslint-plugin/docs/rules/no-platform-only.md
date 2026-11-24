# no-platform-only

Warns on `app.platformOnly(...)`, the typed escape hatch to the underlying tool (Playwright `Page`, WebdriverIO `Browser`).

## Why

toets's promise is that a test means the same thing on every platform. Code inside `platformOnly` runs on one platform and is skipped elsewhere, so the test silently checks different things per platform. It also couples the test to tool internals that toets may replace.

```ts nocheck
// Bad
await app.platformOnly('web', async (page) => {
  await (page as Page).evaluate(() => localStorage.clear());
});

// Good: a core API covers it on every platform
await app.launch({ clearData: true });
```

When a gap is real, prefer declaring it through capabilities (`test(name, requires(...), fn)`). If you must keep the escape hatch, isolate it in a fixture, explain why in a comment, and disable the rule on that line.
