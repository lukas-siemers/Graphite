import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@graphite/canvas',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
