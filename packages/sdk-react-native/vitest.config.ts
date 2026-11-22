import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    conditions: ['source'],
    alias: [
      {
        find: /^react-native$/,
        replacement: fileURLToPath(new URL('./test/mocks/react-native.ts', import.meta.url)),
      },
    ],
  },
  ssr: { resolve: { conditions: ['source'], externalConditions: ['source'] } },
  test: { include: ['src/**/*.test.ts', 'test/**/*.test.ts'] },
});
