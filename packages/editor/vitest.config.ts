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
    },
  },
  test: {
    name: '@graphite/editor',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
