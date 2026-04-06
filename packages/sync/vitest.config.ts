import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@graphite/sync',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
