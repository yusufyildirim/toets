import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'server/index': 'src/server/index.ts',
    'conformance/index': 'src/conformance/index.ts',
    'conformance/cli': 'src/conformance/cli.ts',
  },
  format: 'esm',
  // The main entry is bundled into apps, some running on old TV engines.
  target: 'es2017',
  platform: 'neutral',
  dts: true,
  clean: true,
  fixedExtension: false,
});
