# Contributing

Read [AGENTS.md](./AGENTS.md) and [VISION.md](./VISION.md) first: they hold the layout, rules and locked decisions.

## Setup

Node 24+ and pnpm (versions in [`.tool-versions`](./.tool-versions) and `packageManager`).

```sh
pnpm install
pnpm build
pnpm check
```

`pnpm check` runs format, lint, typecheck, TSDoc validation (`pnpm docs:api`, TypeDoc: broken links and unexported types fail), unit tests and `pnpm docs:check` (docs examples, skills, error codes). It must pass before a change is done.

The example app's suite runs in Chromium with `pnpm build:web && pnpm e2e --project=web` in `examples/tv-app`. Device projects need an emulator or simulator; see its [README](./examples/tv-app/README.md).

CI ([`ci.yml`](./.github/workflows/ci.yml)) runs `pnpm check` and the web E2E suite; device platforms are verified locally.

## Pull requests

- Public API changes ship with TSDoc, docs page updates, skill updates (if affected) and a tested example.
- Add a changeset for user-facing changes: `pnpm changeset`. See [RELEASING.md](./RELEASING.md).
