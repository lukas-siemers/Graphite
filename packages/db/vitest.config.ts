import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@graphite/db',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
