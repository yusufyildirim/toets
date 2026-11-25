# How the DOM maps to elements

toets matchers work on platform-neutral element snapshots. The web driver fills them from the DOM, reading the whole page in one script per call (no per-element round trips) and never waiting: the core retries.

| Field         | Source                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------ |
| `testId`      | `data-testid` (or `testIdAttribute`)                                                       |
| `text`        | Text of rendered descendants, whitespace-collapsed; form fields report their value         |
| `label`       | `aria-label`, else `aria-labelledby` text, else `alt` of images                            |
| `bounds`      | `getBoundingClientRect()` in CSS pixels                                                    |
| `visible`     | Has a box, non-zero size, not `display: none` / `visibility: hidden` (opacity is ignored)  |
| `inViewport`  | Visible and intersecting the viewport after clipping by `overflow` ancestors (e.g. a rail) |
| `focusable`   | Has a `tabindex` (including `-1`) or is natively focusable, and not disabled or `inert`    |
| `focused`     | `document.activeElement` (through open shadow roots)                                       |
| `focusWithin` | The element or a descendant is focused                                                     |
| `enabled`     | Not `:disabled` and no `aria-disabled="true"` on it or an ancestor                         |
| `selected`    | `aria-selected="true"` (or a selected `<option>`)                                          |
| `busy`        | `aria-busy="true"` on it or a descendant                                                   |

Elements are walked in the rendered (flat) tree: open shadow roots and slots are followed; `script`, `style`, `template` and SVG internals are skipped; iframes are not entered. Selector chains are evaluated in the page with exactly the semantics of the core's `evaluateChain` (what every other driver and the SDK path use; a parity test enforces it): text selectors match the deepest elements whose text matches, like Playwright, and `nth` picks among the previous step's matches.

A hidden element still reports its full text, so `getByText('Loading')` finds a hidden spinner and `not.toBeVisible()` can pass.
