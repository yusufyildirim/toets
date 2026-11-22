import { defineConfig } from 'tsdown';
import { allowedImports } from '../../tsdown.shared.ts';

export default defineConfig({
  entry: { index: 'src/index.ts', noop: 'src/noop.ts' },
  format: 'esm',
  // Runs inside apps on Hermes and older TV engines (react-native-web).
  target: 'es2015',
  platform: 'neutral',
  dts: true,
  deps: { onlyImport: allowedImports(import.meta.dirname) },
  clean: true,
  fixedExtension: false,
});
