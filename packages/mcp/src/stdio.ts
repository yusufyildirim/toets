import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadMcpConfig } from './config.js';
import { createDpadMcp } from './server.js';

/** Options of {@link runStdio}. */
export interface RunStdioOptions {
  /** Config file path. Default: `DPAD_MCP_CONFIG`, else `dpad.mcp.config.*` in `cwd`. */
  readonly configFile?: string;
  readonly cwd?: string;
}

/**
 * Serves dpad over stdio until the client disconnects or the process is signalled, then stops
 * the driver and releases the device. stdout carries the protocol, so `console.log` from
 * drivers is redirected to stderr.
 */
export async function runStdio(options: RunStdioOptions = {}): Promise<void> {
  const log = (message: string): void => void process.stderr.write(`${message}\n`);
  console.log = console.error;
  console.info = console.error;

  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadMcpConfig(options.configFile ?? process.env.DPAD_MCP_CONFIG, cwd);
  log(
    loaded
      ? `dpad mcp: config ${loaded.file}, targets: ${Object.keys(loaded.config.targets).join(', ')}`
      : 'dpad mcp: no config found; only docs_search is available',
  );

  const dpad = createDpadMcp({
    config: loaded?.config ?? null,
    baseDir: loaded?.baseDir ?? cwd,
    log,
    docsRoots: [loaded?.baseDir ?? cwd, cwd],
  });

  let closing: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    closing ??= (async () => {
      await handle.close().catch(() => undefined);
      await dpad.close();
    })();
    return closing;
  };

  const handle = serveStdio(() => dpad.createServer(), {
    onerror: (error) => log(`dpad mcp: ${error.message}`),
  });
  process.stdin.once('end', () => void shutdown());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void shutdown().finally(() => process.exit(0)));
  }
}
