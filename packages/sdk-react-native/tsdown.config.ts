import { defineConfig } from 'tsdown';
import { allowedImports } from '../../tsdown.shared.ts';

export default defineConfig({
  entry: { index: 'src/index.ts', noop: 'src/noop.ts' },
  format: 'esm',
  // Runs inside apps on Hermes and older TV engines (react-native-web).
  target: 'es2015',
  platform: 'neutral',
  dts: true,
  // `react-native` is an optional peer: web apps alias it to react-native-web.
  deps: { onlyImport: allowedImports(import.meta.dirname, ['react-native']) },
  clean: true,
  fixedExtension: false,
});
