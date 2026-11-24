/**
 * Targets from a toets test config: the Playwright config whose `platforms.*()` projects carry
 * their toets settings in `use.toets`. Reading them means the MCP server drives exactly what the
 * test suite runs (driver, app, devices, SDK, mocking, key overrides), with no second config.
 */
import type { RuntimeConfig } from '@toets/core/runner';
import type { McpConfig, McpTargetConfig } from './config.js';

/** What `platforms.*()` stores in a project's `use.toets` (see `ToetsProjectConfig` in `@toets/test`). */
interface ProjectToets {
  readonly platform: McpTargetConfig['platform'];
  readonly driver: string;
  readonly driverOptions?: Readonly<Record<string, unknown>>;
  readonly app?: McpTargetConfig['app'];
  readonly device?: { readonly model?: string; readonly osVersion?: string };
  readonly devices?: McpTargetConfig['devices'];
  readonly options?: RuntimeConfig & Readonly<Record<string, unknown>>;
}

interface TestProject {
  readonly name?: string;
  readonly expect?: { readonly timeout?: number };
  readonly use?: { readonly toets?: unknown };
}

interface TestConfig {
  readonly expect?: { readonly timeout?: number };
  readonly projects?: readonly TestProject[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Whether a loaded config module is a Playwright (toets test) config rather than an MCP config. */
export function isTestConfig(value: unknown, file: string): value is TestConfig {
  if (!isObject(value) || 'targets' in value) return false;
  return Array.isArray(value.projects) || /(^|[/\\])playwright\.config\.[cm]?[jt]s$/.test(file);
}

function isProjectToets(value: unknown): value is ProjectToets {
  return isObject(value) && typeof value.platform === 'string' && typeof value.driver === 'string';
}

/** Picks what the core runtime understands; `steps` and `video` are test-only. */
function runtimeOptions(options: ProjectToets['options']): RuntimeConfig {
  const { sdk, mock, keyOverrides, timeouts, idle, remote } = options ?? {};
  return {
    ...(sdk === undefined ? {} : { sdk }),
    ...(mock === undefined ? {} : { mock }),
    ...(keyOverrides === undefined ? {} : { keyOverrides }),
    ...(timeouts === undefined ? {} : { timeouts }),
    ...(idle === undefined ? {} : { idle }),
    ...(remote === undefined ? {} : { remote }),
  };
}

/**
 * One MCP target per toets project, named like the project (`--project` names). The assert
 * timeout follows the project's (or config's) `expect.timeout`, like `expect` in a test.
 * Returns `null` when the config has no toets projects.
 */
export function fromTestConfig(config: TestConfig): McpConfig | null {
  const targets: Record<string, McpTargetConfig> = {};
  for (const project of config.projects ?? []) {
    const toets = project.use?.toets;
    if (!isProjectToets(toets)) continue;
    const base = project.name ?? toets.platform ?? 'target';
    let name = base;
    for (let i = 2; name in targets; i++) name = `${base}-${i}`;
    const expectTimeoutMs = project.expect?.timeout ?? config.expect?.timeout;
    targets[name] = {
      driver: toets.driver,
      ...(toets.platform === undefined ? {} : { platform: toets.platform }),
      options: toets.driverOptions ?? {},
      app: toets.app ?? {},
      ...(toets.device?.model === undefined ? {} : { model: toets.device.model }),
      ...(toets.device?.osVersion === undefined ? {} : { osVersion: toets.device.osVersion }),
      ...(toets.devices === undefined ? {} : { devices: toets.devices }),
      toets: runtimeOptions(toets.options),
      ...(expectTimeoutMs === undefined ? {} : { expectTimeoutMs }),
    };
  }
  return Object.keys(targets).length ? { targets } : null;
}
