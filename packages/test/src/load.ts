import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DpadError, docsLink } from '@dpad-tv/core';

const isPath = (specifier: string): boolean =>
  specifier.startsWith('.') || isAbsolute(specifier) || specifier.startsWith('file:');

/**
 * Imports a module the user installed (a driver, `@dpad-tv/mock`). Packages are resolved from
 * the user's config directory first, so strict package managers (pnpm) work without dpad
 * depending on every driver; paths are relative to the config directory.
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
        // try the next base, then a plain import from dpad itself
      }
    }
  }
  try {
    return (await import(url ?? specifier)) as Record<string, unknown>;
  } catch (cause) {
    const notFound =
      (cause as { code?: string }).code === 'ERR_MODULE_NOT_FOUND' ||
      (cause as { code?: string }).code === 'MODULE_NOT_FOUND';
    throw new DpadError(
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
        docs: docsLink('test/config'),
        cause,
      },
    );
  }
}
