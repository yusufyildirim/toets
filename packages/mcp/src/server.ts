import { McpServer } from '@modelcontextprotocol/server';
import pkg from '../package.json' with { type: 'json' };
import type { McpConfig } from './config.js';
import { DocsIndex, findDocsSources } from './docs/search.js';
import { Session } from './session.js';
import { registerAppTools } from './tools/app.js';
import { registerDocsTools } from './tools/docs.js';
import { registerInputTools } from './tools/input.js';
import { registerInspectTools } from './tools/inspect.js';
import type { ToolContext } from './tools/shared.js';

/** Sent to the client on connect; agents read it before using any tool. */
export const SERVER_INSTRUCTIONS = `toets drives TV apps the way a user does: with a remote control.
- There is no click, tap, hover, scroll or typing into elements. Everything goes through focus: move it with D-pad keys (UP/DOWN/LEFT/RIGHT), activate the focused element with SELECT, go back with BACK.
- Loop: launch -> snapshot (what is on screen, where focus is) -> navigate_to / press -> assert. Re-snapshot after every interaction; screens change.
- Point at elements by test ID first, text second. Tools run the same toets core code as tests (locators, remote, navigateTo, matchers, text snapshots) and answer with the matching test code.
- Keys beyond the D-pad, SELECT and BACK depend on the platform: check capabilities.
- Unsure about an API, error or pattern? docs_search.`;

/** Options of {@link createToetsMcp}. */
export interface ToetsMcpOptions {
  /** Targets to drive. `null`/omitted: only `docs_search` works; device tools explain how to configure. */
  readonly config?: McpConfig | null;
  /** Folder relative paths in the config resolve against. Default: `process.cwd()`. */
  readonly baseDir?: string;
  /** Diagnostics sink. Default: stderr. Never write to stdout on stdio transports. */
  readonly log?: (message: string) => void;
  /** Roots to search for `node_modules/@toets/*\/docs`. Default: `[baseDir, process.cwd()]`. */
  readonly docsRoots?: readonly string[];
}

/** A toets MCP instance: one session (driver, device, app) shared by the servers it creates. */
export interface ToetsMcp {
  /** Creates an MCP server exposing the toets tools over this instance's session. */
  createServer(): McpServer;
  /** Stops the driver and releases the device. */
  close(): Promise<void>;
}

/**
 * Creates the toets MCP server factory. Connect a transport to `createServer()` yourself, or use
 * `runStdio` (what the `toets-mcp` binary does).
 *
 * @example
 * ```ts
 * const toets = createToetsMcp({ config });
 * await toets.createServer().connect(transport);
 * ```
 */
export function createToetsMcp(options: ToetsMcpOptions = {}): ToetsMcp {
  const baseDir = options.baseDir ?? process.cwd();
  const log = options.log ?? ((message: string) => process.stderr.write(`${message}\n`));
  const session = new Session({ config: options.config ?? null, baseDir, log });

  let index: Promise<DocsIndex> | undefined;
  const docs = (): Promise<DocsIndex> => {
    index ??= DocsIndex.build(
      findDocsSources(options.docsRoots ?? [baseDir, process.cwd()], session.docsDirs),
    ).catch((error: unknown) => {
      index = undefined;
      throw error;
    });
    return index;
  };
  const ctx: ToolContext = { session, docs };

  return {
    createServer() {
      const server = new McpServer(
        { name: 'toets', version: pkg.version },
        { instructions: SERVER_INSTRUCTIONS },
      );
      registerAppTools(server, ctx);
      registerInputTools(server, ctx);
      registerInspectTools(server, ctx);
      registerDocsTools(server, ctx);
      return server;
    },
    close: () => session.dispose(),
  };
}
