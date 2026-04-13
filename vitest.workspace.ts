import { defineWorkspace } from 'vitest/config';

// Vitest 1.6 discovers workspace projects from this file (vitest.workspace.ts).
// Each entry is a path to a standalone vitest.config.ts — Vitest loads them as
// sub-projects and aggregates results. This replaces the old root
// vitest.config.ts, which tried to use `test.workspace` (a Vitest 3+ option)
// and crashed with `TypeError: input.replace is not a function` because the
// string paths were forwarded to micromatch as globs in an unsupported shape.
export default defineWorkspace([
  'packages/canvas/vitest.config.ts',
  'packages/db/vitest.config.ts',
  'packages/editor/vitest.config.ts',
  'packages/sync/vitest.config.ts',
  'packages/ui/vitest.config.ts',
  'apps/mobile/vitest.config.ts',
  'apps/desktop/vitest.config.ts',
]);
