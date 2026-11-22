import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import base from '../../vitest.shared.ts';

export default mergeConfig(
  base,
  defineConfig({
    resolve: {
      alias: [
        {
          find: /^react-native$/,
          replacement: fileURLToPath(new URL('./test/mocks/react-native.ts', import.meta.url)),
        },
      ],
    },
  }),
);
