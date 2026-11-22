import { defineConfig } from 'tsdown';
import { allowedImports } from '../../tsdown.shared.ts';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: 'esm',
  dts: true,
  deps: { onlyImport: allowedImports(import.meta.dirname) },
  clean: true,
  fixedExtension: false,
});
