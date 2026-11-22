# Locators

A locator describes how to find an element, not the element itself. It is resolved again on every action and assertion, so it never goes stale when the screen re-renders.

```ts
const rail = app.getByTestId('rail_trending');
const card = rail.getByText(/the matrix/i).first();

await app.focus.navigateTo(card);
await expect(card).toBeFocused();
```

## Principles

- **Prefer test IDs.** `getByTestId` maps to `data-testid` (web), resource ID (Android) and accessibility identifier (tvOS). Text changes with locale and copy edits.
- **Chains narrow.** Each step searches inside the previous matches. The first step searches the whole screen, root included.
- **Text matching:** a string is a case-insensitive substring after whitespace normalization; `{ exact: true }` is a case-sensitive full match; a `RegExp` is tested as is. Text matches resolve to the deepest element that carries the text.
- **Strict by default.** Actions and single-element assertions fail when a locator matches more than one element. Add `.first()`, `.nth(i)` or a narrower chain. `toHaveCount` and `count()` accept many.
- **`app.focus.current()`** is a locator for whatever is focused right now.

## TV trap: virtualized lists

TV rails and grids render only the items near focus. An item ten cards to the right does not exist yet, so `getByTestId('card_10')` finds nothing. Navigate toward it first (`app.focus.navigateTo` walks the visible part), or press `RIGHT` until it appears, then locate it.
