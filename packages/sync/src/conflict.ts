import type { ConflictResolution } from './types';

export interface HasUpdatedAt {
  updatedAt: number;
}

/**
 * Last-write-wins conflict resolution. Picks whichever side has the larger
 * updatedAt timestamp. Ties go to remote (Supabase is authoritative on equality).
 *
 * Phase 2 v1 strategy. Phase 3 may introduce CRDT-based merge via Yjs.
 */
export function resolveByLastWrite<T extends HasUpdatedAt>(
  local: T,
  remote: T,
): ConflictResolution<T> {
  if (local.updatedAt > remote.updatedAt) {
    return { winner: 'local', value: local };
  }
  return { winner: 'remote', value: remote };
}
