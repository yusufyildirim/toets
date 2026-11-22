import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/reporter.ts'],
  format: 'esm',
  dts: true,
  clean: true,
  fixedExtension: false,
});
