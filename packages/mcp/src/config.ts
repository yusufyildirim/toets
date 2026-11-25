import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ToetsError,
  Key,
  packageDocsLink,
  type AppTargetConfig,
  type DriverModule,
  type KeyboardDefinition,
  type Platform,
} from '@toets/core';
import type { DeviceSelection, RuntimeConfig } from '@toets/core/runner';
import { z } from 'zod';
import { fromTestConfig, isTestConfig } from './test-config.js';

/**
 * One platform target the MCP server can drive. Same vocabulary as a `platforms.*()` project in
 * the toets test config, so a target behaves like the project it mirrors.
 */
export interface McpTargetConfig {
  /**
   * Driver package name (e.g. `@toets/driver-web`), a path to a module, or the module itself.
   * Packages and paths are imported lazily and must default-export a `DriverModule`.
   */
  readonly driver: string | DriverModule<never>;
  /** Expected platform; the driver must drive it. Default: whatever the driver drives. */
  readonly platform?: Platform;
  /** Driver options, passed to `createDriver` as-is. */
  readonly options?: Readonly<Record<string, unknown>>;
  /** Per-platform app config (URL, APK, bundle ID, ...), as in the toets test config. */
  readonly app?: AppTargetConfig;
  /** Device model for the device provider, e.g. `tv_1080p`. */
  readonly model?: string;
  /** OS version for the device provider, e.g. `34`. */
  readonly osVersion?: string;
  /** Where the device comes from. Default: `managed` when the driver provides devices. */
  readonly devices?: DeviceSelection;
  /** Runtime options, as the test config's `toets`: `sdk`, `mock`, `keyOverrides`, `timeouts`, ... */
  readonly toets?: RuntimeConfig;
  /** Default timeout of the `assert` tool for this target. */
  readonly expectTimeoutMs?: number;
  /** App-drawn keyboards (`defineKeyboard`) for this target; replaces the top-level ones. */
  readonly keyboards?: readonly KeyboardDefinition[];
}

/** Config of the toets MCP server. */
export interface McpConfig {
  /** Named targets, e.g. `{ web: {...}, androidTV: {...} }`. */
  readonly targets: Readonly<Record<string, McpTargetConfig>>;
  /** Target used until `launch` picks another. Default: the first one. */
  readonly defaultTarget?: string;
  /** Default timeout of the `assert` tool. Default 5000. */
  readonly expectTimeoutMs?: number;
  /** Runtime options for every target; a target's `toets` overrides them. */
  readonly toets?: RuntimeConfig;
  /** App-drawn keyboards (`defineKeyboard`) for every target, as the test config's `keyboards`. */
  readonly keyboards?: readonly KeyboardDefinition[];
  /** Where drivers write artifacts (videos, logs). Default: a temp directory. */
  readonly artifactsDir?: string;
  /** Extra docs folders for `docs_search`, besides the shipped docs of installed toets packages. */
  readonly docsDirs?: readonly string[];
}

/** Typed identity helper for `toets.mcp.config.ts`. */
export function defineMcpConfig(config: McpConfig): McpConfig {
  return config;
}

/** MCP config file names looked up in the working directory when no path is given. */
export const CONFIG_FILES = [
  'toets.mcp.config.ts',
  'toets.mcp.config.mts',
  'toets.mcp.config.js',
  'toets.mcp.config.mjs',
  'toets.mcp.config.json',
] as const;

/** toets test configs (Playwright configs with `platforms.*()` projects), looked up after them. */
export const TEST_CONFIG_FILES = [
  'playwright.config.ts',
  'playwright.config.mts',
  'playwright.config.js',
  'playwright.config.mjs',
] as const;

const fn = z.custom<(...args: never[]) => unknown>((v) => typeof v === 'function', {
  error: 'expected a function',
});

const driverModuleSchema = z.custom<DriverModule<never>>(
  (v) =>
    typeof v === 'object' &&
    v !== null &&
    typeof (v as DriverModule).platform === 'string' &&
    typeof (v as DriverModule).createDriver === 'function',
  'expected a package name, a module path or a DriverModule',
);

const keySchema = z.enum(Object.values(Key) as [Key, ...Key[]]);
const ms = z.number().int().min(0);

const runtimeSchema = z
  .object({
    sdk: z
      .union([
        z.boolean(),
        z.object({ port: z.number().int().optional(), createHost: fn.optional() }).strict(),
      ])
      .optional(),
    mock: z
      .union([
        z.boolean(),
        z.object({ port: z.number().int().optional(), createServer: fn.optional() }).strict(),
      ])
      .optional(),
    keyOverrides: z
      .partialRecord(keySchema, z.object({ as: keySchema, holdMs: ms.optional() }).strict())
      .optional(),
    timeouts: z
      .object({
        expectMs: ms.optional(),
        actionMs: ms.optional(),
        sdkConnectMs: ms.optional(),
        navigationSettleMs: ms.optional(),
      })
      .strict()
      .optional(),
    idle: z.object({ quietMs: ms.optional(), budgetMs: ms.optional() }).strict().optional(),
    remote: z.object({ intervalMs: ms.optional(), longPressMs: ms.optional() }).strict().optional(),
  })
  .strict();

const devicesSchema = z.union([
  z.literal('managed'),
  z.object({ mode: z.literal('managed') }).strict(),
  z
    .object({ mode: z.literal('external'), addresses: z.array(z.string().min(1)).optional() })
    .strict(),
  z
    .object({
      mode: z.literal('command'),
      acquire: z.string().min(1),
      release: z.string().optional(),
      acquireTimeoutMs: ms.optional(),
      releaseTimeoutMs: ms.optional(),
      cwd: z.string().optional(),
    })
    .strict(),
]);

/** Shape only; the core validates definitions when the target starts (`defineKeyboard`). */
const keyboardsSchema = z.array(z.object({ name: z.string().min(1) }).loose());

const configSchema = z
  .object({
    targets: z
      .record(
        z.string().min(1),
        z
          .object({
            driver: z.union([z.string().min(1), driverModuleSchema], {
              error: 'expected a driver package name, a module path or a DriverModule',
            }),
            platform: z.enum(['web', 'android-tv', 'tvos']).optional(),
            options: z.record(z.string(), z.unknown()).optional(),
            app: z.record(z.string(), z.unknown()).optional(),
            model: z.string().optional(),
            osVersion: z.string().optional(),
            devices: devicesSchema.optional(),
            toets: runtimeSchema.optional(),
            expectTimeoutMs: z.number().int().positive().optional(),
            keyboards: keyboardsSchema.optional(),
          })
          .strict(),
      )
      .refine((t) => Object.keys(t).length > 0, 'define at least one target'),
    defaultTarget: z.string().optional(),
    expectTimeoutMs: z.number().int().positive().optional(),
    toets: runtimeSchema.optional(),
    keyboards: keyboardsSchema.optional(),
    artifactsDir: z.string().optional(),
    docsDirs: z.array(z.string()).optional(),
  })
  .strict()
  .refine((c) => c.defaultTarget === undefined || c.defaultTarget in c.targets, {
    message: 'defaultTarget must name one of the targets',
    path: ['defaultTarget'],
  });

/** Validates a config object, throwing a `ToetsError` that lists every problem. */
export function validateMcpConfig(value: unknown, source = 'config'): McpConfig {
  const parsed = configSchema.safeParse(value);
  // The input itself, not zod's copy: driver modules and factories stay the same objects.
  if (parsed.success) return value as McpConfig;
  const problems = parsed.error.issues
    .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new ToetsError('MCP_CONFIG_INVALID', `Invalid toets MCP ${source}:\n${problems}`, {
    hint: 'Fix the listed fields. A config needs `targets` with at least one `{ driver }` entry.',
    docs: packageDocsLink('mcp', 'setup'),
  });
}

/** A loaded config and the directory relative paths in it resolve against. */
export interface LoadedMcpConfig {
  readonly config: McpConfig;
  readonly baseDir: string;
  /** The file it came from. */
  readonly file: string;
  /** `mcp`: a toets MCP config; `test`: targets read from a toets test (Playwright) config. */
  readonly kind: 'mcp' | 'test';
}

async function importConfig(path: string): Promise<unknown> {
  try {
    if (path.endsWith('.json')) return JSON.parse(await readFile(path, 'utf8'));
    const mod = (await import(pathToFileURL(path).href)) as { default?: unknown };
    return mod.default ?? mod;
  } catch (cause) {
    throw new ToetsError('MCP_CONFIG_INVALID', `Could not load config ${path}.`, {
      hint: `${(cause as Error).message ?? String(cause)}. TypeScript configs run through Node's type stripping: erasable syntax only, and relative imports need their file extension.`,
      docs: packageDocsLink('mcp', 'setup'),
      cause,
    });
  }
}

async function fromFile(path: string): Promise<LoadedMcpConfig | null> {
  const value = await importConfig(path);
  const baseDir = dirname(path);
  if (isTestConfig(value, path)) {
    const config = fromTestConfig(value);
    return config ? { config, baseDir, file: path, kind: 'test' } : null;
  }
  return { config: validateMcpConfig(value, `config ${path}`), baseDir, file: path, kind: 'mcp' };
}

/**
 * Loads the config from `file`, or finds one in `cwd`: a {@link CONFIG_FILES} entry first, then
 * a toets test config ({@link TEST_CONFIG_FILES}) whose `platforms.*()` projects become targets.
 * A file is read by its shape (`targets`: MCP config; `projects`: test config), so `file` may
 * name either. Returns `null` when no path is given and nothing usable exists (the server then
 * only offers docs).
 */
export async function loadMcpConfig(
  file?: string,
  cwd: string = process.cwd(),
  log: (message: string) => void = () => {},
): Promise<LoadedMcpConfig | null> {
  if (file) {
    const path = resolve(cwd, file);
    if (!existsSync(path)) {
      throw new ToetsError('MCP_CONFIG_NOT_FOUND', `Config not found at ${path}.`, {
        hint: 'Check the `--config` path (relative paths resolve against the working directory).',
        docs: packageDocsLink('mcp', 'setup'),
      });
    }
    const loaded = await fromFile(path);
    if (loaded) return loaded;
    throw new ToetsError('MCP_CONFIG_INVALID', `${path} has no toets projects.`, {
      hint: 'Pass a toets MCP config (`targets`) or a toets test config with `platforms.*()` projects.',
      docs: packageDocsLink('mcp', 'setup'),
    });
  }
  for (const name of [...CONFIG_FILES, ...TEST_CONFIG_FILES]) {
    const path = resolve(cwd, name);
    if (!existsSync(path)) continue;
    const loaded = await fromFile(path);
    if (loaded) return loaded;
    log(`toets mcp: ${path} has no toets projects; skipped`);
  }
  return null;
}
