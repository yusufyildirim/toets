#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { DpadError } from '@dpad-tv/core';
import pkg from '../package.json' with { type: 'json' };
import { runStdio } from './stdio.js';

const USAGE = `dpad-mcp ${pkg.version} - dpad MCP server (stdio)

Usage: dpad-mcp [--config <file>]

Options:
  -c, --config <file>  dpad MCP config or dpad test (Playwright) config. Default: $DPAD_MCP_CONFIG,
                       else dpad.mcp.config.{ts,mts,js,mjs,json}, else playwright.config.{ts,mts,js,mjs}
  -h, --help           Show this help
  -v, --version        Show the version

Docs: node_modules/@dpad-tv/mcp/docs/setup.md`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });
  if (values.help) return void process.stderr.write(`${USAGE}\n`);
  if (values.version) return void process.stderr.write(`${pkg.version}\n`);
  await runStdio(values.config === undefined ? {} : { configFile: values.config });
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof DpadError ? error.toString() : String(error)}\n`);
  process.exit(1);
});
