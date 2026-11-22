# AGENTS.md

dpad: cross-platform E2E testing for TV apps (web, Android TV / Fire TV, tvOS). Pre-code; [VISION.md](./VISION.md) is the source of truth for goals, decisions and scope. Read it before proposing designs.

## Rules

- **Docs are part of the feature.** Public API changes ship with TSDoc, docs page updates, skill updates (if affected) and a tested example, in the same change.
- **Docs style:** concise, principles over procedures, one concept per page, one minimal example. See VISION.md > Documentation.
- **Parity over convenience.** Matchers and actions live in the core over driver snapshots. Never implement behavior per platform when the core can own it; platforms declare gaps through capabilities.
- **No app-specific code** in dpad. App concerns belong in user config and fixtures.
- **Locked decisions** in VISION.md change only with an explicit update to that file.
- Plain dash `-`, never em dash.
