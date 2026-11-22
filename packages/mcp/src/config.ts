import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DpadError, packageDocsLink, type AppTargetConfig, type DriverModule } from '@dpad-tv/core';
import { z } from 'zod';

/** Where a target's device comes from (device-backed platforms only). */
export type McpDeviceConfig =
  /** An already running emulator/simulator, e.g. `emulator-5554` or a simulator UDID. */
  | { readonly address: string }
  /** Let the driver's `managed` provider create/boot one. */
  | { readonly managed: true; readonly model?: string; readonly osVersion?: string };

/** One platform target the MCP server can drive. */
export interface McpTargetConfig {
  /**
   * Driver package name (e.g. `@dpad-tv/driver-web`), a path to a module, or the module itself.
   * Packages and paths are imported lazily and must default-export a `DriverModule`.
   */
  readonly driver: string | DriverModule<never>;
  /** Driver options, passed to `createDriver` as-is. */
  readonly options?: Readonly<Record<string, unknown>>;
  /** Per-platform app config (URL, APK, bundle ID, ...), as in the dpad test config. */
  readonly app?: AppTargetConfig;
  readonly device?: McpDeviceConfig;
}

/** Config of the dpad MCP server. */
export interface McpConfig {
  /** Named targets, e.g. `{ web: {...}, androidTV: {...} }`. */
  readonly targets: Readonly<Record<string, McpTargetConfig>>;
  /** Target used until `launch` picks another. Default: the first one. */
  readonly defaultTarget?: string;
  /** Default timeout of the `assert` tool. Default 5000. */
  readonly expectTimeoutMs?: number;
  /** Where drivers write artifacts (videos, logs). Default: a temp directory. */
  readonly artifactsDir?: string;
  /** Extra docs folders for `docs_search`, besides the shipped docs of installed dpad packages. */
  readonly docsDirs?: readonly string[];
}

/** Typed identity helper for `dpad.mcp.config.ts`. */
export function defineMcpConfig(config: McpConfig): McpConfig {
  return config;
}

/** File names looked up in the working directory when no config path is given. */
export const CONFIG_FILES = [
  'dpad.mcp.config.ts',
  'dpad.mcp.config.mts',
  'dpad.mcp.config.js',
  'dpad.mcp.config.mjs',
  'dpad.mcp.config.json',
] as const;

const driverModuleSchema = z.custom<DriverModule<never>>(
  (v) =>
    typeof v === 'object' &&
    v !== null &&
    typeof (v as DriverModule).platform === 'string' &&
    typeof (v as DriverModule).createDriver === 'function',
  'expected a package name, a module path or a DriverModule',
);

const configSchema = z
  .object({
    targets: z
      .record(
        z.string().min(1),
        z.object({
          driver: z.union([z.string().min(1), driverModuleSchema], {
            error: 'expected a driver package name, a module path or a DriverModule',
          }),
          options: z.record(z.string(), z.unknown()).optional(),
          app: z.record(z.string(), z.unknown()).optional(),
          device: z
            .union([
              z.object({ address: z.string().min(1) }).strict(),
              z
                .object({
                  managed: z.literal(true),
                  model: z.string().optional(),
                  osVersion: z.string().optional(),
                })
                .strict(),
            ])
            .optional(),
        }),
      )
      .refine((t) => Object.keys(t).length > 0, 'define at least one target'),
    defaultTarget: z.string().optional(),
    expectTimeoutMs: z.number().int().positive().optional(),
    artifactsDir: z.string().optional(),
    docsDirs: z.array(z.string()).optional(),
  })
  .strict()
  .refine((c) => c.defaultTarget === undefined || c.defaultTarget in c.targets, {
    message: 'defaultTarget must name one of the targets',
    path: ['defaultTarget'],
  });

/** Validates a config object, throwing a `DpadError` that lists every problem. */
export function validateMcpConfig(value: unknown, source = 'config'): McpConfig {
  const parsed = configSchema.safeParse(value);
  if (parsed.success) return parsed.data as McpConfig;
  const problems = parsed.error.issues
    .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  throw new DpadError('MCP_CONFIG_INVALID', `Invalid dpad MCP ${source}:\n${problems}`, {
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
}

/**
 * Loads the MCP config from `file`, or finds one of {@link CONFIG_FILES} in `cwd`.
 * Returns `null` when no path is given and none exists (the server then only offers docs).
 * TypeScript configs rely on Node's built-in type stripping.
 */
export async function loadMcpConfig(
  file?: string,
  cwd: string = process.cwd(),
): Promise<LoadedMcpConfig | null> {
  const path = file
    ? resolve(cwd, file)
    : CONFIG_FILES.map((f) => resolve(cwd, f)).find((f) => existsSync(f));
  if (!path) return null;
  if (!existsSync(path)) {
    throw new DpadError('MCP_CONFIG_NOT_FOUND', `dpad MCP config not found at ${path}.`, {
      hint: 'Check the `--config` path (relative paths resolve against the working directory).',
      docs: packageDocsLink('mcp', 'setup'),
    });
  }
  let value: unknown;
  try {
    if (path.endsWith('.json')) {
      value = JSON.parse(await readFile(path, 'utf8'));
    } else {
      const mod = (await import(pathToFileURL(path).href)) as { default?: unknown };
      value = mod.default ?? mod;
    }
  } catch (cause) {
    throw new DpadError('MCP_CONFIG_INVALID', `Could not load dpad MCP config ${path}.`, {
      hint: `${(cause as Error).message ?? String(cause)}. TypeScript configs must use erasable syntax only (Node type stripping).`,
      docs: packageDocsLink('mcp', 'setup'),
      cause,
    });
  }
  return { config: validateMcpConfig(value, `config ${path}`), baseDir: dirname(path), file: path };
}
