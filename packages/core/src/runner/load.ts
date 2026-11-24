import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { DriverModule } from '../driver.js';
import { ToetsError, packageDocsLink } from '../errors.js';
import type { Platform } from '../platform.js';

const isPath = (specifier: string): boolean =>
  specifier.startsWith('.') || isAbsolute(specifier) || specifier.startsWith('file:');

/**
 * Imports a module the user installed (a driver, a config). Packages are resolved from the
 * user's config directory first, so strict package managers (pnpm) work without toets depending
 * on every driver; paths are relative to the config directory.
 */
export async function importUserModule(
  specifier: string,
  baseDir: string,
  purpose: string,
): Promise<Record<string, unknown>> {
  let url: string | null = null;
  if (specifier.startsWith('file:')) {
    url = specifier;
  } else if (isPath(specifier)) {
    url = pathToFileURL(resolve(baseDir, specifier)).href;
  } else {
    for (const dir of [baseDir, process.cwd()]) {
      try {
        url = pathToFileURL(createRequire(join(dir, 'noop.js')).resolve(specifier)).href;
        break;
      } catch {
        // try the next base, then a plain import from toets itself
      }
    }
  }
  try {
    return (await import(url ?? specifier)) as Record<string, unknown>;
  } catch (cause) {
    const notFound =
      (cause as { code?: string }).code === 'ERR_MODULE_NOT_FOUND' ||
      (cause as { code?: string }).code === 'MODULE_NOT_FOUND';
    throw new ToetsError(
      'MODULE_NOT_FOUND',
      notFound
        ? `Cannot find ${specifier} (${purpose}).`
        : `Loading ${specifier} (${purpose}) failed: ${String(cause)}`,
      {
        hint: notFound
          ? isPath(specifier)
            ? `Paths are resolved from the config directory (${baseDir}).`
            : `Install it in your project: npm install -D ${specifier}`
          : 'The module threw while loading; see the cause.',
        docs: packageDocsLink('test', 'config'),
        cause,
      },
    );
  }
}

function isDriverModule(value: unknown): value is DriverModule {
  const m = value as Partial<DriverModule> | null | undefined;
  return (
    typeof m === 'object' &&
    m !== null &&
    typeof m.createDriver === 'function' &&
    typeof m.platform === 'string'
  );
}

/**
 * Loads a driver: a package name or path (imported lazily with {@link importUserModule}, so
 * users install only the platforms they target) or a `DriverModule` itself. Checks the module
 * shape and, when `platform` is given, that it drives that platform.
 */
export async function loadDriverModule(
  driver: string | DriverModule<never>,
  baseDir: string,
  platform?: Platform,
): Promise<DriverModule> {
  const name = typeof driver === 'string' ? driver : 'The configured driver module';
  const candidate =
    typeof driver === 'string'
      ? (await importUserModule(driver, baseDir, `${platform ?? 'toets'} driver`)).default
      : driver;
  if (!isDriverModule(candidate)) {
    throw new ToetsError(
      'INVALID_DRIVER',
      `${name} does not default-export a toets DriverModule.`,
      {
        hint: 'A driver package must `export default { platform, createDriver }` (see DriverModule in @toets/core). Point `driver` at a toets driver package such as `@toets/driver-web`.',
        docs: packageDocsLink('test', 'config'),
      },
    );
  }
  if (platform !== undefined && candidate.platform !== platform) {
    throw new ToetsError(
      'INVALID_DRIVER',
      `${name} drives ${candidate.platform}, but the project is ${platform}.`,
      {
        hint: 'Use the platform helper that matches the driver.',
        docs: packageDocsLink('test', 'config'),
      },
    );
  }
  return candidate;
}
