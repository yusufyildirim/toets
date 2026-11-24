import { defineConfig, type Rolldown } from 'tsdown';
import { allowedImports } from '../../tsdown.shared.ts';

/** Driver packages are optional peers: their types are inlined into our `.d.ts`, never imported. */
const DRIVER = /^@toets\/driver-/;

/**
 * The inlined web driver types import Playwright handles (`Page`, `BrowserContextOptions`, ...)
 * from `playwright-core`, which is not our dependency. `@playwright/test` (a required peer)
 * re-exports all of `playwright-core`, so point those declaration imports there.
 */
const playwrightTypesFromPeer: Rolldown.Plugin = {
  name: 'toets:playwright-types-from-peer',
  resolveId: {
    order: 'pre',
    handler(id, importer) {
      if (id === 'playwright-core' && importer?.endsWith('.d.ts')) {
        return { id: '@playwright/test', external: true };
      }
      return null;
    },
  },
};

export default defineConfig({
  entry: ['src/index.ts', 'src/reporter.ts'],
  format: 'esm',
  dts: true,
  deps: {
    dts: {
      alwaysBundle: [DRIVER],
      // Bundle only the driver declarations; `playwright-core` goes to the plugin above.
      neverBundle: (id) =>
        id !== 'playwright-core' && !id.startsWith('.') && !id.startsWith('/') && !DRIVER.test(id),
    },
    onlyImport: allowedImports(import.meta.dirname),
  },
  plugins: [playwrightTypesFromPeer],
  clean: true,
  fixedExtension: false,
});
