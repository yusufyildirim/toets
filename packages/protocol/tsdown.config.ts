import { defineConfig } from 'tsdown';

export default defineConfig({
  // One build so all entries share chunks: `ProtocolError` and friends must be the same
  // class whether imported from the main entry or thrown by the host.
  entry: {
    index: 'src/index.ts',
    'server/index': 'src/server/index.ts',
    'conformance/index': 'src/conformance/index.ts',
    'conformance/cli': 'src/conformance/cli.ts',
  },
  format: 'esm',
  // The main entry is bundled into apps, including older TV engines and Hermes.
  target: 'es2015',
  platform: 'node',
  dts: true,
  clean: true,
  fixedExtension: false,
});
