# dpad docs (maintainers)

The docs site, `llms.txt` generation, the agent skills checks and the code example checks. Not part of the site itself.

```sh
pnpm docs:dev     # local site with hot reload
pnpm docs:build   # static site + llms.txt + llms-full.txt in docs/.vitepress/dist
pnpm docs:check   # typecheck, unit tests, code examples, skills
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
- Slugs are stable. Errors (`DpadError.docs`), skills and the `AGENTS.md` template reference them; renaming a page means updating those.

### Package pages

Packages own `packages/<pkg>/docs/`. Those pages ship in the npm package, so:

- Link to other pages of the same package relatively, and to other packages as `../../<other>/docs/<page>.md`; that path works in the repo, in `node_modules/@dpad-tv/` and on the site.
- Link to site pages (concepts, guides) with absolute site URLs, not relative paths outside the package.
- Optional frontmatter: `title`, `description`, `order` (number, sidebar order; `index.md` comes first by default).

## Code examples

`pnpm --filter @dpad-tv/docs check:examples` extracts fenced `ts`, `tsx`, `js` and `json` blocks from `docs/`, `packages/*/docs/` and `skills/`, then type-checks them with the repository's strict compiler options (JSON is parsed). Errors point at the markdown line.

| Marker                                 | Effect                                             |
| -------------------------------------- | -------------------------------------------------- |
| none                                   | type-checked                                       |
| fence meta `run`                       | type-checked, then executed with Node              |
| fence meta `nocheck`                   | never checked: fragments, sketches, output samples |
| fence meta `pending`                   | not checked until the API it shows exists          |
| `<!-- examples: pending -->` on a page | every block on the page is pending                 |

`--list-pending` lists what waits. Enable a page by removing its marker once its API is implemented.

**Resolution.** `@dpad-tv/test` and `@dpad-tv/mock` resolve to the workspace packages once their source exports something, and to the contract stand-ins in `scripts/examples/contract/` until then (`--resolve=auto`, the default). Force either with `--resolve=contract` or `--resolve=real`. When both packages are implemented, delete the stand-ins.

`run` blocks import packages as Node resolves them, so build the workspace first (`pnpm build`). Keep them free of devices and network.

## Skills

`skills/<name>/SKILL.md`, in the [agent skills format](https://agentskills.io/specification). `check:skills` enforces:

- frontmatter `name` (matches the folder) and `description` (says precisely when to trigger), no unknown keys;
- a body of at most 150 lines: link to pages by slug (`` `concepts/focus` ``) instead of inlining them;
- every slug mentioned in a skill or in `templates/AGENTS.md` resolves to a page.
