/**
 * Targets from a dpad test config: the Playwright config whose `platforms.*()` projects carry
 * their dpad settings in `use.dpad`. Reading them means the MCP server drives exactly what the
 * test suite runs (driver, app, devices, SDK, mocking, key overrides), with no second config.
 */
import type { RuntimeConfig } from '@dpad-tv/core/runner';
import type { McpConfig, McpTargetConfig } from './config.js';

/** What `platforms.*()` stores in a project's `use.dpad` (see `DpadProjectConfig` in `@dpad-tv/test`). */
interface ProjectDpad {
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
  readonly use?: { readonly dpad?: unknown };
}

interface TestConfig {
  readonly expect?: { readonly timeout?: number };
  readonly projects?: readonly TestProject[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/** Whether a loaded config module is a Playwright (dpad test) config rather than an MCP config. */
export function isTestConfig(value: unknown, file: string): value is TestConfig {
  if (!isObject(value) || 'targets' in value) return false;
  return Array.isArray(value.projects) || /(^|[/\\])playwright\.config\.[cm]?[jt]s$/.test(file);
}

function isProjectDpad(value: unknown): value is ProjectDpad {
  return isObject(value) && typeof value.platform === 'string' && typeof value.driver === 'string';
}

/** Picks what the core runtime understands; `steps` and `video` are test-only. */
function runtimeOptions(options: ProjectDpad['options']): RuntimeConfig {
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
 * One MCP target per dpad project, named like the project (`--project` names). The assert
 * timeout follows the project's (or config's) `expect.timeout`, like `expect` in a test.
 * Returns `null` when the config has no dpad projects.
 */
export function fromTestConfig(config: TestConfig): McpConfig | null {
  const targets: Record<string, McpTargetConfig> = {};
  for (const project of config.projects ?? []) {
    const dpad = project.use?.dpad;
    if (!isProjectDpad(dpad)) continue;
    const base = project.name ?? dpad.platform ?? 'target';
    let name = base;
    for (let i = 2; name in targets; i++) name = `${base}-${i}`;
    const expectTimeoutMs = project.expect?.timeout ?? config.expect?.timeout;
    targets[name] = {
      driver: dpad.driver,
      ...(dpad.platform === undefined ? {} : { platform: dpad.platform }),
      options: dpad.driverOptions ?? {},
      app: dpad.app ?? {},
      ...(dpad.device?.model === undefined ? {} : { model: dpad.device.model }),
      ...(dpad.device?.osVersion === undefined ? {} : { osVersion: dpad.device.osVersion }),
      ...(dpad.devices === undefined ? {} : { devices: dpad.devices }),
      dpad: runtimeOptions(dpad.options),
      ...(expectTimeoutMs === undefined ? {} : { expectTimeoutMs }),
    };
  }
  return Object.keys(targets).length ? { targets } : null;
}
