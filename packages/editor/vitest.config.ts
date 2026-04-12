import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve the db workspace so `ink-paths.ts`'s type import
      // (`import type { CanvasSchemaV1 } from '@graphite/db'`) succeeds
      // without a build step. The tests consume the namespaced Zod types
      // directly to guard against schema drift.
      '@graphite/db': path.resolve(__dirname, '../db/src/index.ts'),
      // React is hoisted under apps/mobile in this monorepo. Point Vitest
      // at that copy so `.tsx` tests (InkOverlay web renderer) can import
      // it without a bundler.
      react: path.resolve(__dirname, '../../apps/mobile/node_modules/react'),
    },
  },
  esbuild: {
    // Required so `.tsx` tests can use JSX with React 19's automatic runtime.
    jsx: 'automatic',
  },
  test: {
    name: '@graphite/editor',
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
