import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace package aliases so Vitest can import them without
      // a bundler that understands yarn workspaces.
      '@graphite/canvas': path.resolve(__dirname, '../../packages/canvas/src/index.ts'),
      '@graphite/db': path.resolve(__dirname, '../../packages/db/src/index.ts'),
      '@graphite/ui': path.resolve(__dirname, '../../packages/ui/src/index.ts'),
    },
  },
  test: {
    name: '@graphite/mobile',
    environment: 'node',
    include: ['stores/**/*.test.ts', 'app/**/*.test.ts', 'hooks/**/*.test.ts', 'lib/**/*.test.ts'],
  },
});
