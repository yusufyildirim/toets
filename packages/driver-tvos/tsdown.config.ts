import { defineConfig } from 'tsdown';
import { allowedImports } from '../../tsdown.shared.ts';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  dts: true,
  deps: { onlyImport: allowedImports(import.meta.dirname) },
  clean: true,
  fixedExtension: false,
});
