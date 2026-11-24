import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadMcpConfig } from './config.js';
import { createToetsMcp } from './server.js';

/** Options of {@link runStdio}. */
export interface RunStdioOptions {
  /**
   * Config file: a toets MCP config or a toets test (Playwright) config. Default: `TOETS_MCP_CONFIG`,
   * else `toets.mcp.config.*`, else `playwright.config.*` in `cwd`.
   */
  readonly configFile?: string;
  readonly cwd?: string;
}

/**
 * Serves toets over stdio until the client disconnects or the process is signalled, then stops
 * the driver and releases the device. stdout carries the protocol, so `console.log` from
 * drivers is redirected to stderr.
 */
export async function runStdio(options: RunStdioOptions = {}): Promise<void> {
  const log = (message: string): void => void process.stderr.write(`${message}\n`);
  console.log = console.error;
  console.info = console.error;

  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadMcpConfig(options.configFile ?? process.env.TOETS_MCP_CONFIG, cwd, log);
  log(
    loaded
      ? `toets mcp: ${loaded.kind === 'test' ? 'test config' : 'config'} ${loaded.file}, targets: ${Object.keys(loaded.config.targets).join(', ')}`
      : 'toets mcp: no config found; only docs_search is available',
  );

  const toets = createToetsMcp({
    config: loaded?.config ?? null,
    baseDir: loaded?.baseDir ?? cwd,
    log,
    docsRoots: [loaded?.baseDir ?? cwd, cwd],
  });

  let closing: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    closing ??= (async () => {
      await handle.close().catch(() => undefined);
      await toets.close();
    })();
    return closing;
  };

  const handle = serveStdio(() => toets.createServer(), {
    onerror: (error) => log(`toets mcp: ${error.message}`),
  });
  process.stdin.once('end', () => void shutdown());
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void shutdown().finally(() => process.exit(0)));
  }
}
