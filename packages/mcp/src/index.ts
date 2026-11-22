/**
 * `@dpad-tv/mcp`: an MCP server that lets agents explore TV apps with the same primitives dpad
 * tests use (launch, remote keys, focus navigation, text snapshots, matchers) and search the
 * shipped dpad docs. Most users only run the `dpad-mcp` binary; the API below is for embedding.
 */
export {
  CONFIG_FILES,
  defineMcpConfig,
  loadMcpConfig,
  validateMcpConfig,
  type LoadedMcpConfig,
  type McpConfig,
  type McpDeviceConfig,
  type McpTargetConfig,
} from './config.js';
export { createDpadMcp, SERVER_INSTRUCTIONS, type DpadMcp, type DpadMcpOptions } from './server.js';
export { runStdio, type RunStdioOptions } from './stdio.js';
