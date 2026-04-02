/**
 * Graphite sync engine — Phase 2.
 *
 * This package is ONLY initialized for Pro subscribers.
 * Free users never import from this package.
 *
 * Rules (from CLAUDE.md Phase 2):
 * - Supabase client instantiated ONLY inside this package, never in UI components.
 * - Push: find all notes where is_dirty = 1 → upsert to Supabase.
 * - Pull: subscribe to Supabase Realtime channel per user_id.
 * - Conflict: compare updated_at, keep whichever is newer (last-write-wins).
 * - After push: mark is_dirty = 0, write synced_at = Date.now().
 * - Realtime channel scoped to user_id — never per-note.
 */

export type { SyncStatus, SyncResult, SyncConfig } from './types';

/**
 * Placeholder — Phase 2 implementation goes here.
 * Will accept a SyncConfig and return a SyncEngine instance.
 */
export function createSyncEngine(_config: import('./types').SyncConfig): never {
  throw new Error('Sync engine not yet implemented — Phase 2 feature.');
}
