# MCP server setup

`@dpad-tv/mcp` is an [MCP](https://modelcontextprotocol.io) server (stdio) that lets an agent drive your TV app with the same primitives dpad tests use, and search the dpad docs. Use it to explore an app before writing or debugging a test.

## Install

```sh
pnpm add -D @dpad-tv/mcp @dpad-tv/driver-web   # plus the drivers you target
```

## Config

Create `dpad.mcp.config.ts` (or `.mts`, `.js`, `.mjs`, `.json`) in the project root. Each target names a driver package and its options; drivers load lazily, so only the ones you use must be installed.

```ts
import { defineMcpConfig } from '@dpad-tv/mcp';

export default defineMcpConfig({
  targets: {
    web: { driver: '@dpad-tv/driver-web', app: { url: 'http://localhost:3000' } },
    androidTV: {
      driver: '@dpad-tv/driver-android-tv',
      app: { apk: './artifacts/app.apk', package: 'com.example.tv' },
      device: { address: 'emulator-5554' }, // or { managed: true, model: 'tv_1080p' }
    },
  },
  defaultTarget: 'web',
});
```

| Field             | Meaning                                                                        |
| ----------------- | ------------------------------------------------------------------------------ |
| `targets`         | Named targets: `driver` (package, path or module), `options`, `app`, `device`. |
| `defaultTarget`   | Target used until `launch` picks another. Default: the first.                  |
| `expectTimeoutMs` | Default `assert` timeout. Default 5000.                                        |
| `artifactsDir`    | Where drivers write artifacts. Default: a temp folder.                         |
| `docsDirs`        | Extra docs folders for `docs_search`.                                          |

Relative paths resolve against the config file's folder. TypeScript configs run through Node's type stripping, so keep them to erasable syntax. Without a config the server still starts and `docs_search` works.

## Add it to your MCP client

The server command is `dpad-mcp` (options: `--config <file>`, or `DPAD_MCP_CONFIG`). Clients usually start servers in the project root; pass `--config` when they do not.

**Claude Code**

```sh
claude mcp add --scope project dpad -- npx dpad-mcp
```

**Cursor** (`.cursor/mcp.json`), and most other clients with the same shape:

```json
{ "mcpServers": { "dpad": { "command": "npx", "args": ["dpad-mcp"] } } }
```

## Notes

- One session drives one target at a time. `launch({ target })` switches, stopping the previous driver and releasing its device.
- The server owns the device while it runs. Stop it (close the client) before running the test suite on the same emulator or simulator.
- stdout is the protocol channel; diagnostics go to stderr.

Next: [tools](./tools.md), [workflow](./workflow.md).
