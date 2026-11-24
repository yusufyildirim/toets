# MCP server setup

`@toets/mcp` is an [MCP](https://modelcontextprotocol.io) server (stdio) that lets an agent drive your TV app with the same primitives toets tests use, and search the toets docs. Use it to explore an app before writing or debugging a test.

Targets come up exactly like a test worker (same core runner): device, driver, SDK host, mock server and the core runtime. Snapshots, key handling and assertions are the core code tests run, so what passes in the MCP passes in a test.

## Install

```sh
pnpm add -D @toets/mcp @toets/driver-web   # plus the drivers you target
```

## Config

Without a config of its own, the server reads your toets test config (`playwright.config.ts`): every `platforms.*()` project becomes a target named like the project, with its driver, app, devices and `toets` options, and `expect.timeout` as the `assert` timeout. Nothing else to set up.

For targets the test config does not have, create `toets.mcp.config.ts` (or `.mts`, `.js`, `.mjs`, `.json`). It wins over the test config. Each target uses the same vocabulary as a `platforms.*()` project; drivers load lazily, so only the ones you use must be installed.

```ts
import { defineMcpConfig } from '@toets/mcp';

export default defineMcpConfig({
  targets: {
    web: { driver: '@toets/driver-web', app: { url: 'http://localhost:3000' } },
    androidTV: {
      driver: '@toets/driver-android-tv',
      app: { apk: './artifacts/app.apk', package: 'com.example.tv' },
      devices: { mode: 'external', addresses: ['emulator-5554'] }, // or 'managed' with `model`
      toets: { sdk: true },
    },
  },
  defaultTarget: 'web',
  toets: { mock: true },
});
```

| Field             | Meaning                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| `targets`         | Named targets (fields below).                                                                  |
| `defaultTarget`   | Target used until `launch` picks another. Default: the first.                                  |
| `toets`           | Runtime options for every target, merged under each target's `toets` (like the test config's). |
| `expectTimeoutMs` | Default `assert` timeout. Default 5000.                                                        |
| `artifactsDir`    | Where drivers write artifacts. Default: a temp folder.                                         |
| `docsDirs`        | Extra docs folders for `docs_search`.                                                          |

A target: `driver` (package, path or module), `platform`, `options` (driver options), `app`, `devices`, `model`, `osVersion`, `toets` (`sdk`, `mock`, `keyOverrides`, `timeouts`, `idle`, `remote`) and `expectTimeoutMs`.

Relative paths resolve against the config file's folder. Without any config the server still starts and `docs_search` works.

Limits of reading the test config: it is imported by Node, not by Playwright, so a TypeScript config must use erasable syntax only and relative imports need their file extension (use `toets.mcp.config.*` otherwise). `webServer` is not started; start the app yourself. Test-only options (`steps`, `video`) are ignored.

## Add it to your MCP client

The server command is `toets-mcp` (options: `--config <file>`, either kind, or `TOETS_MCP_CONFIG`). Clients usually start servers in the project root; pass `--config` when they do not.

**Claude Code**

```sh
claude mcp add --scope project toets -- npx toets-mcp
```

**Cursor** (`.cursor/mcp.json`), and most other clients with the same shape:

```json
{ "mcpServers": { "toets": { "command": "npx", "args": ["toets-mcp"] } } }
```

## Notes

- One session drives one target at a time. `launch({ target })` switches, stopping the previous driver and releasing its device.
- Each `launch` is isolated like a fresh test: mock handlers, recorded requests and logs are reset.
- With `sdk` on, `launch` accepts `state` and `flags`; with `mock` on, `assert` can check `toHaveRequested`.
- The server owns the device while it runs. Stop it (close the client) before running the test suite on the same emulator or simulator.
- stdout is the protocol channel; diagnostics go to stderr.

Next: [tools](./tools.md), [workflow](./workflow.md).
