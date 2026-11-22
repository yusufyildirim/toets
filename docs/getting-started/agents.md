---
description: Give coding agents what they need to write and debug dpad tests - skills, an AGENTS.md template, llms.txt, offline docs and the MCP server.
---

# Working with agents

Most dpad tests are written and maintained by coding agents, so dpad ships its knowledge in forms agents load cheaply. An agent with no prior context should be able to set up dpad, write a correct cross-platform test and debug a failure from these alone.

| Artifact     | Where                                                | Use                                                     |
| ------------ | ---------------------------------------------------- | ------------------------------------------------------- |
| Skills       | `skills/` in the dpad repository                     | Task-level guidance, loaded when the task matches       |
| `AGENTS.md`  | Your project root (template below)                   | Project rules every agent session sees                  |
| Offline docs | `node_modules/@dpad-tv/*/docs/`                      | Version-matched pages, no network needed                |
| `llms.txt`   | Docs site root, with `llms-full.txt`                 | Index of every page, and every page in one file         |
| Errors       | Test output                                          | Each error has a code, a hint and a docs link           |
| Error codes  | [Error code index](../reference/core/docs/errors.md) | Every `DpadError` code, generated from the sources      |
| MCP server   | [`@dpad-tv/mcp`](../reference/mcp.md)                | Explore a running app with the same primitives as tests |

## Skills

Four skills in the [open agent skills format](https://agentskills.io), each short and linking to pages here instead of repeating them:

| Skill                 | Triggers when the agent                                    |
| --------------------- | ---------------------------------------------------------- |
| `dpad-setup`          | adds dpad to a project, adds a platform or sets up CI      |
| `dpad-write-tests`    | writes or changes dpad tests or page objects               |
| `dpad-debug-failures` | investigates a failing or flaky dpad test                  |
| `dpad-migrate`        | ports tests from Playwright, Appium / WebdriverIO or Detox |

Install all of them into your project with the [skills CLI](https://github.com/vercel-labs/skills), which detects the agents you use:

```sh
npx skills add dpad-tv/dpad
npx skills add dpad-tv/dpad --skill dpad-write-tests   # just one
```

Or copy `skills/<name>/` from the repository into your agent's skills folder (for example `.claude/skills/` or `.agents/skills/`). Skills refer to docs pages by slug, such as `concepts/focus`: the page at `/concepts/focus` on this site.

## `AGENTS.md` template

Drop this into your project's `AGENTS.md` (or merge it into the one you have) and fill in the comment:

<<< @/docs/templates/AGENTS.md{md}

## Docs for agents

- Prefer the offline copy in `node_modules`: it matches the installed version.
- [`llms.txt`](/llms.txt) indexes every page with a one-line summary; [`llms-full.txt`](/llms-full.txt) is the whole site in one file. Every page is also served as markdown: append `.md` to its URL.
- Errors are docs too. A failing test prints `DpadError: [CODE] what happened`, the likely cause and fix (`Hint:`) and the page to read (`Docs:`, with its offline path in `node_modules`). Agents should act on those before guessing; the [error code index](../reference/core/docs/errors.md) lists every code.
