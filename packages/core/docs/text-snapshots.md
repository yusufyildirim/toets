# Text snapshots

A text snapshot is a small YAML outline of what the user sees: visible, on-screen elements, their text and their state. It is the cheapest way to assert a whole screen, and the format AI agents read best.

```ts
await expect(app.getByTestId('rail')).toMatchTextSnapshot(`
  - rail:
    - card_1 "Movie 1" [focused]
    - card_2 "Movie 2"
`);

await expect(app).toMatchTextSnapshot(); // per-platform baseline file
```

## Format

- One entry per element: `- name "text" [states]`. The name is the test ID, else `text`, else `element`.
- States: `focused`, `selected`, `busy`, `disabled`, `offscreen`.
- Only visible elements inside the viewport are listed, plus the focused element even when it is offscreen. Wrappers with no test ID, text or state are flattened away.
- An empty screen is `[]`.

## Principles

- **Inline for intent, files for coverage.** An inline snapshot documents what matters in the test. Without an argument the snapshot is compared to a baseline file per project (platform), written on the first run and updated with `--update-snapshots`.
- **Indentation is ignored** in inline snapshots, so they can follow the code's indentation.
- **Retried like any assertion** until it matches or times out; the failure shows a line diff.
- **`app.snapshot()`** returns the same text, handy for debugging and for agents.

## TV trap: offscreen rail items

Rails keep offscreen items in the tree. They are left out of snapshots on purpose, so a snapshot does not change when an item scrolls in from far away, only when the user can see it.
