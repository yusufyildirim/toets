import { defineConfig } from 'tsdown';
import { allowedImports } from '../../tsdown.shared.ts';

export default defineConfig({
  entry: { index: 'src/index.ts', 'web/index': 'src/web/index.ts', noop: 'src/noop.ts' },
  format: 'esm',
  // Runs inside apps, including older TV browser engines and Hermes.
  target: 'es2015',
  platform: 'neutral',
  dts: true,
  deps: { onlyImport: allowedImports(import.meta.dirname) },
  clean: true,
  fixedExtension: false,
});
