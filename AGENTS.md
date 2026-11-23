# AGENTS.md

dpad: cross-platform E2E testing for TV apps (web, Android TV / Fire TV, tvOS) on Playwright Test. [VISION.md](./VISION.md) holds goals, locked decisions and the roadmap; the [docs](./docs/index.md) explain how everything works.

## Layout

- `packages/*`: the `@dpad-tv/*` packages. Each ships its own `docs/` folder.
- `docs/`: the docs site, plus the checks for examples, skills and error codes ([docs/README.md](./docs/README.md)).
- `skills/`: agent skills shipped to users.
- `examples/tv-app`: React Native TV app (web, Android TV, tvOS) with the cross-platform E2E suite ([README](./examples/tv-app/README.md)).

## Commands

- `pnpm build`, then `pnpm check`: format, lint, typecheck, TSDoc validation, unit tests, docs checks. Must pass before a change is done.
- Example suite in Chromium: `pnpm build:web && pnpm e2e --project=web` in `examples/tv-app`. Device projects need an emulator or simulator; see its README.

## Rules

- **Docs are part of the feature.** Public API changes ship with TSDoc, docs page updates, skill updates (if affected) and a tested example, in the same change. Style: VISION.md > Documentation.
- **Parity over convenience.** Matchers and actions live in the core over driver snapshots. Never implement behavior per platform when the core can own it; platforms declare gaps through capabilities.
- **No app-specific code** in dpad. App concerns belong in user config and fixtures.
- **Errors** are `DpadError` with `code`, `hint` and `docs`. `packages/core/docs/errors.md` is generated; never edit it by hand.
- **Locked decisions** in VISION.md change only with an explicit update to that file.
- Plain dash `-`, never em dash.
