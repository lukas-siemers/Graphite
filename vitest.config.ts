import { defineConfig } from 'vitest/config';

// vitest.config.ts must export a plain config object (via defineConfig), not
// the workspace array that defineWorkspace returns — Vite's config loader
// rejects non-object exports with "config must export or return an object".
// The workspace list is passed via the test.workspace option instead.
export default defineConfig({
  test: {
    workspace: [
      'packages/*/vitest.config.ts',
      'apps/mobile/vitest.config.ts',
      'apps/desktop/vitest.config.ts',
    ],
  },
});
