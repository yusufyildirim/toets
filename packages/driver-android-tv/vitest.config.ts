import { defineConfig } from 'vitest/config';

// Resolve workspace packages to their TypeScript sources (the `source` export condition), also
// in the SSR (Node) environment Vitest runs tests in. The rest are Vite's server defaults.
const conditions = ['source', 'module', 'node', 'development|production'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: { include: ['src/**/*.test.ts', 'test/**/*.test.ts'] },
});
