# toets docs (maintainers)

The docs site, `llms.txt` generation, the agent skills checks and the code example checks. Not part of the site itself.

```sh
pnpm docs:dev     # local site with hot reload
pnpm docs:build   # static site + llms.txt + llms-full.txt in docs/.vitepress/dist
pnpm docs:check   # typecheck, unit tests, code examples, skills, error codes (part of `pnpm check`)
```

## What the site renders

The VitePress source root is the repository (`srcDir: '..'`); rewrites map files to URLs, so nothing is copied:

| Source                          | URL                            | Owner       |
| ------------------------------- | ------------------------------ | ----------- |
| `docs/<slug>.md`                | `/<slug>`                      | docs        |
| `packages/<pkg>/docs/<page>.md` | `/reference/<pkg>/docs/<page>` | the package |
| `skills/<name>/SKILL.md`        | `/skills/<name>`               | docs        |
| `docs/reference/[pkg].md`       | `/reference/<pkg>` (generated) | docs        |

`docs/templates/` and this file are excluded. Sidebar, nav and `llms.txt` order come from `.vitepress/sidebar.ts`; package pages appear there automatically.

## Writing pages

Follow VISION.md > Documentation. In short:

- One concept per page, principles over procedures, no marketing.
- Frontmatter `description`: one sentence, used in `llms.txt` and meta tags.
- One minimal, complete example: a whole file with its imports, so readers can copy it and the check can compile it.
- A **Traps** section for where web or mobile intuition is wrong on TV.
- Link pages with relative `.md` links (`./focus.md`); the build fails on dead links.
- Slugs are stable. Errors (`ToetsError.docs`), skills and the `AGENTS.md` template reference them; renaming a page means updating those.

### Package pages

Packages own `packages/<pkg>/docs/`. Those pages ship in the npm package, so:

- Link to other pages of the same package relatively, and to other packages as `../../<other>/docs/<page>.md`; that path works in the repo, in `node_modules/@toets/` and on the site.
- Link to site pages (concepts, guides) with absolute site URLs, not relative paths outside the package.
- Optional frontmatter: `title`, `description`, `order` (number, sidebar order; `index.md` comes first by default).

## Code examples

`pnpm --filter @toets/docs check:examples` extracts fenced `ts`, `tsx`, `js` and `json` blocks from `docs/`, `packages/*/docs/` and `skills/`, then type-checks them with the repository's strict compiler options (JSON is parsed). Errors point at the markdown line.

| Marker                                 | Effect                                             |
| -------------------------------------- | -------------------------------------------------- |
| none                                   | type-checked                                       |
| fence meta `run`                       | type-checked, then executed (see below)            |
| fence meta `nocheck`                   | never checked: fragments, sketches, output samples |
| fence meta `pending`                   | not checked until the API it shows exists          |
| `<!-- examples: pending -->` on a page | every block on the page is pending                 |

`--list-pending` lists what waits. Enable a page by removing its marker once its API is implemented.

**Resolution.** `@toets/*` imports resolve to the workspace sources; every package an example imports must be a dev dependency of `docs/`. Third-party imports the docs do not install (`axios`, Metro) belong in `nocheck` blocks.

**Running.** `run` blocks import packages as Node resolves them, so build the workspace first (`pnpm build`). Keep them free of devices and network.

- A `run` block that imports `@toets/test` is a test file. All of them run in one Playwright Test invocation against the **demo app** (`scripts/examples/demo-app/`): an in-memory TV app built on the core's `FakeDriver`, with the config's mock handlers as its backend and a `FakeSdkHost` for media and launch state. Failures point at the markdown line of the failing assertion.
- Other `run` blocks execute with Node.

Make a test example `run` whenever the demo app can show it. The demo app implements the screens the docs talk about (side menu, hero with play and like buttons, rails `rail-0`, `rail-1` and `rail-popular`, details, guide, watchlist, first-run terms and profile picker) with kebab-case test IDs; write new examples against those IDs, or extend the app (`app.ts`) and its baseline data (`playwright.config.ts`) together with the example. Leave a test example check-only only when it needs what a fake cannot show (a real device, pixels, platform-specific behavior).

## Skills

`skills/<name>/SKILL.md`, in the [agent skills format](https://agentskills.io/specification). `check:skills` enforces:

- frontmatter `name` (matches the folder) and `description` (says precisely when to trigger), no unknown keys;
- a body of at most 150 lines: link to pages by slug (`` `concepts/focus` ``) instead of inlining them;
- every slug mentioned in a skill or in `templates/AGENTS.md` resolves to a page.

## Error codes

`packages/core/docs/errors.md` is generated from the sources: every `ToetsError` code thrown in `packages/*/src` (test doubles in `src/testing/` excluded) and every declared `*ErrorCode` type, with its message or doc comment and its `docs` page. `check:errors` fails when the page is stale, a code has no meaning or a docs path points at no page. Regenerate with `pnpm --filter @toets/docs errors`; never edit the page by hand. Generic codes whose messages vary get their meaning from `MEANINGS` in `scripts/error-codes.ts`.
