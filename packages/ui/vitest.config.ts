import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@graphite/ui',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
