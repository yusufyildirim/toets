import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/runner/index.ts', 'src/testing/index.ts'],
  format: 'esm',
  dts: true,
  clean: true,
  fixedExtension: false,
});
