/**
 * Sync engine types — Phase 2.
 * Supabase client is NOT imported here; it is lazily injected at runtime
 * only for users with an active Pro subscription.
 */

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  errors: string[];
  syncedAt: number;
}

export interface SyncConfig {
  userId: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}
