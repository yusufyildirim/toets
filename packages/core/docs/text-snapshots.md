# Text snapshots

A text snapshot is a small YAML outline of what the user sees: visible, on-screen elements, their text and their state. It is the cheapest way to assert a whole screen, and the format AI agents read best.

```ts nocheck
await expect(app.getByTestId('rail')).toMatchTextSnapshot(`
  - rail:
    - card_1 "Movie 1" [focused]
    - card_2 "Movie 2"
`);

await expect(app).toMatchTextSnapshot(); // per-platform baseline file
```

## Format

- One entry per element: `- name "text" [states]`. The name is the test ID, else `text`, else `element`.
- States: `focused`, `selected`, `busy`, `disabled`, `offscreen`, then `editable` and `secure` for system text fields, whose entry ends with their value instead of text: `- email [editable] value="ada@example.com"`, `- password [editable, secure] value="••••"`.
- A declared app keyboard is one line without children: `- 'osk [keyboard: search, layer: lower, focused: "m"]'` (quoted: YAML). A snapshot of the keyboard's root lists its keys. See [text input](./text-input.md).
- Only visible elements inside the viewport are listed, plus the focused element even when it is offscreen. Wrappers with no test ID, text or state are flattened away.
- An empty screen is `[]`.

## Principles

- **Inline for intent, files for coverage.** An inline snapshot documents what matters in the test. Without an argument the snapshot is compared to a baseline file per project (platform), updated with `--update-snapshots`. A missing baseline is written and the test fails once (Playwright's `toMatchSnapshot`); file names carry the host OS (`-darwin`, `-linux`) unless `snapshotPathTemplate` drops `{platform}`.
- **Indentation is ignored** in inline snapshots, so they can follow the code's indentation.
- **Retried like any assertion** until it matches or times out; the failure shows a line diff.
- **`app.snapshot()`** returns the same text, handy for debugging and for agents.

## TV trap: offscreen rail items

Rails keep offscreen items in the tree. They are left out of snapshots on purpose, so a snapshot does not change when an item scrolls in from far away, only when the user can see it.

## Parity trap: nesting comes from the tree

The outline nests like the tree it is read from. The SDK tree and the web DOM nest like the app's components, but a black-box platform tree may not: React Native on Android lists a plain `View`'s descendants as its siblings (see the Android TV driver's traps). An inline snapshot meant for every platform should cover a container that keeps its children everywhere, or run with `toets.sdk`.
