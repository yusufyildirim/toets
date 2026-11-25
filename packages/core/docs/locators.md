# Locators

A locator describes how to find an element, not the element itself. It is resolved again on every action and assertion, so it never goes stale when the screen re-renders.

```ts nocheck
const rail = app.getByTestId('rail-popular');
const card = rail.getByText(/the matrix/i).first();

await app.focus.pressUntilFocused(Key.RIGHT, card);
await expect(card).toBeFocused();
```

## Principles

- **Prefer test IDs.** `getByTestId` maps to `data-testid` (web), resource ID (Android) and accessibility identifier (tvOS). Text changes with locale and copy edits.
- **Chains narrow.** Each step searches inside the previous matches. The first step searches the whole screen, root included.
- **Text matching:** a string is a case-insensitive substring after whitespace normalization; `{ exact: true }` is a case-sensitive full match; a `RegExp` is tested as is. Text matches resolve to the deepest element that carries the text.
- **Strict by default.** Actions and single-element assertions fail when a locator matches more than one element. Add `.first()`, `.nth(i)` or a narrower chain. `toHaveCount` and `count()` accept many.
- **`app.focus.current()`** is a locator for whatever is focused right now.
- **The one action is `fill(text)`**: it replaces a field's text through its keyboard, reaching the field with real presses ([text input](./text-input.md)). Everything else is focus and keys; there is no click.

## TV trap: virtualized lists

TV rails and grids render only the items near focus. An item ten cards to the right does not exist yet, so `getByTestId('rail-0-card-10')` finds nothing. Press toward it: `app.focus.pressUntilFocused(Key.RIGHT, card)` works before the card exists, re-reading the screen after every press.
