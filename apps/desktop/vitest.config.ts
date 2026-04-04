import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@graphite/desktop',
    environment: 'node',
    include: ['electron/__tests__/**/*.test.ts'],
  },
});
