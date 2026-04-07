/** Canonical identifier for a syncable record. */
export type RecordId = string;

/** Which SQLite table this dirty record belongs to. */
export type SyncTable = 'notebooks' | 'folders' | 'notes';

/** A record that has been modified locally and needs to be pushed. */
export interface DirtyRecord {
  id: RecordId;
  table: SyncTable;
  updatedAt: number;
  /**
   * Full row data to upsert to Supabase (excluding user_id, which the
   * engine injects automatically).
   */
  data: Record<string, unknown>;
}

/** Callback signature for realtime change events from Supabase. */
export type RemoteChangeCallback = (
  table: SyncTable,
  event: 'INSERT' | 'UPDATE' | 'DELETE',
  newRecord: Record<string, unknown> | null,
  oldRecord: Record<string, unknown> | null,
) => void;

/** The result of attempting to resolve a conflict between local and remote. */
export type ConflictResolution<T> =
  | { winner: 'local'; value: T }
  | { winner: 'remote'; value: T }
  | { winner: 'merged'; value: T };

/** Current state of the sync engine. */
export type SyncState =
  | 'idle'
  | 'syncing'
  | 'error'
  | 'offline'
  | 'disabled';

/** Result of a single sync cycle (push + pull). */
export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  errors: Array<{ record: RecordId; message: string }>;
  startedAt: number;
  finishedAt: number;
}

/** Configuration for the sync engine. */
export interface SyncEngineConfig {
  /** Supabase URL (read from env in Phase 2). Stub in scaffold. */
  supabaseUrl: string;
  /** Supabase anon key (read from env in Phase 2). Stub in scaffold. */
  supabaseAnonKey: string;
  /** User id from auth session. Required before sync can start. */
  userId: string;
  /** Poll interval in ms for fallback sync (Realtime is primary). */
  pollIntervalMs?: number;
}
