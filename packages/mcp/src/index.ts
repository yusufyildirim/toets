/**
 * `@toets/mcp`: an MCP server that lets agents explore TV apps with the same primitives toets
 * tests use (launch, remote keys, focus navigation, text snapshots, matchers) and search the
 * shipped toets docs. Most users only run the `toets-mcp` binary; the API below is for embedding.
 */
export {
  CONFIG_FILES,
  TEST_CONFIG_FILES,
  defineMcpConfig,
  loadMcpConfig,
  validateMcpConfig,
  type LoadedMcpConfig,
  type McpConfig,
  type McpTargetConfig,
} from './config.js';
export {
  createToetsMcp,
  SERVER_INSTRUCTIONS,
  type ToetsMcp,
  type ToetsMcpOptions,
} from './server.js';
export { runStdio, type RunStdioOptions } from './stdio.js';
