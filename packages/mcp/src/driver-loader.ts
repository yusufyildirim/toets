import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DpadError, docsLink, type DriverModule } from '@dpad-tv/core';

/**
 * Imports a driver package or module path lazily (users install only the platforms they
 * target) and checks it default-exports a `DriverModule`. Package names resolve from `baseDir`
 * (the config's folder), so the user's installed drivers are found.
 */
export async function loadDriverModule(
  driver: string | DriverModule<never>,
  baseDir: string,
): Promise<DriverModule<Record<string, unknown>>> {
  if (typeof driver !== 'string') return checkModule(driver, 'the configured module');

  let mod: unknown;
  try {
    mod = await import(resolveSpecifier(driver, baseDir));
  } catch (cause) {
    throw new DpadError('MCP_DRIVER_NOT_FOUND', `Could not load driver "${driver}".`, {
      hint: driver.startsWith('.')
        ? `Check the path; it resolves against ${baseDir}.`
        : `Install it next to your config (e.g. \`pnpm add -D ${driver}\`). Cause: ${(cause as Error).message}`,
      docs: docsLink('mcp/setup'),
      cause,
    });
  }
  const exported = (mod as { default?: unknown }).default ?? mod;
  return checkModule(exported, `"${driver}"`);
}

function resolveSpecifier(spec: string, baseDir: string): string {
  if (spec.startsWith('.') || isAbsolute(spec)) return pathToFileURL(resolve(baseDir, spec)).href;
  try {
    return pathToFileURL(createRequire(join(baseDir, 'package.json')).resolve(spec)).href;
  } catch {
    // ESM-only packages without a `require`/`default` export condition: let `import` resolve it.
    return spec;
  }
}

function checkModule(value: unknown, name: string): DriverModule<Record<string, unknown>> {
  const mod = value as Partial<DriverModule> | null;
  if (
    typeof mod !== 'object' ||
    mod === null ||
    typeof mod.platform !== 'string' ||
    typeof mod.createDriver !== 'function'
  ) {
    throw new DpadError('MCP_DRIVER_INVALID', `${name} does not default-export a DriverModule.`, {
      hint: 'A driver package default-exports `{ platform, createDriver }` (see `DriverModule` in @dpad-tv/core). Point `driver` at a dpad driver package such as `@dpad-tv/driver-web`.',
      docs: docsLink('mcp/setup'),
    });
  }
  return mod as DriverModule<Record<string, unknown>>;
}
