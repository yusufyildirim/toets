import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Workspace packages resolve to their sources. Not via the `source` export condition in SSR:
// that would also pick TypeScript sources of third-party packages that publish one.
const packages = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  resolve: {
    conditions: ['source'],
    alias: [
      { find: /^@dpad-tv\/([\w-]+)$/, replacement: `${packages}$1/src/index.ts` },
      { find: /^@dpad-tv\/([\w-]+)\/([\w-]+)$/, replacement: `${packages}$1/src/$2/index.ts` },
    ],
  },
  test: { include: ['src/**/*.test.ts', 'test/**/*.test.ts'] },
});
