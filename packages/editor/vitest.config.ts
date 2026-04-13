import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@graphite/editor',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
