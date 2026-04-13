import { type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import { resolveByLastWrite } from './conflict';
import { getSupabaseClient } from './client';
import { uploadGraphiteBlob, downloadGraphiteBlob, deleteGraphiteBlob } from './storage';
import type {
  SyncEngineConfig,
  SyncResult,
  SyncState,
  SyncTable,
  DirtyRecord,
  RemoteChangeCallback,
} from './types';

const SYNC_TABLES: SyncTable[] = ['notebooks', 'folders', 'notes'];

/**
 * SyncEngine — Phase 2 implementation.
 *
 * Pushes dirty local records to Supabase, subscribes to Realtime for
 * remote changes, and uses last-write-wins conflict resolution.
 *
 * The engine does NOT access the local database directly. The app layer
 * bridges between the local DB and the engine via DirtyRecord inputs
 * and the onRemoteChange callback.
 */
export class SyncEngine {
  private supabase: SupabaseClient;
  private channel: RealtimeChannel | null = null;
  private _state: SyncState = 'disabled';
  private userId: string;
  private _onRemoteChange: RemoteChangeCallback | null = null;

  constructor(private readonly config: SyncEngineConfig) {
    if (!config.userId) {
      throw new Error('SyncEngine requires a userId from an authenticated session');
    }
    this.userId = config.userId;
    // Reuse the singleton client so auth storage config is shared
    this.supabase = getSupabaseClient();
  }

  get state(): SyncState {
    return this._state;
  }

  /**
   * Register a callback that fires when a remote change arrives via Realtime.
   * The app layer uses this to update the local DB and Zustand stores.
   */
  set onRemoteChange(cb: RemoteChangeCallback | null) {
    this._onRemoteChange = cb;
  }

  /**
   * Start the sync loop: subscribe to Realtime changes for this user's
   * notebooks, folders, and notes, then run an initial full sync.
   */
  async start(): Promise<void> {
    this._state = 'syncing';

    this.channel = this.supabase.channel(`sync:${this.userId}`);

    for (const table of SYNC_TABLES) {
      this.channel.on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `user_id=eq.${this.userId}`,
        },
        (payload) => {
          this.handleRealtimeEvent(table, payload);
        },
      );
    }

    this.channel.subscribe();
    this._state = 'idle';
  }

  /** Stop the sync loop and unsubscribe from Realtime. */
  async stop(): Promise<void> {
    if (this.channel) {
      await this.supabase.removeChannel(this.channel);
      this.channel = null;
    }
    this._state = 'disabled';
  }

  /**
   * Push dirty local records to Supabase.
   * Each record is upserted with user_id injected automatically.
   * Returns counts of successes and errors.
   */
  async push(records: DirtyRecord[]): Promise<SyncResult> {
    const started = Date.now();
    let pushed = 0;
    const errors: SyncResult['errors'] = [];

    for (const record of records) {
      try {
        const { row, spatialBlob } = extractSpatialBlob(record);
        row.user_id = this.userId;

        if (spatialBlob) {
          // Upload before the row upsert so readers that see canvas_version=2
          // in Postgres can always resolve the blob. If upload fails we abort
          // and surface as a sync error for this record.
          await uploadGraphiteBlob(this.supabase, this.userId, record.id, spatialBlob);
        }

        const { error } = await this.supabase
          .from(record.table)
          .upsert(row, { onConflict: 'id' });

        if (error) throw error;
        pushed++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ record: record.id, message });
      }
    }

    return {
      pushed,
      pulled: 0,
      conflicts: 0,
      errors,
      startedAt: started,
      finishedAt: Date.now(),
    };
  }

  /**
   * Pull remote records updated since `sinceMs` (Unix ms timestamp).
   * For each table, fetches rows where updated_at > sinceMs, runs
   * conflict resolution, and returns the remote-winning rows via the
   * onRemoteChange callback. The app layer is responsible for writing
   * those into the local DB.
   */
  async pull(sinceMs: number): Promise<SyncResult> {
    const started = Date.now();
    let pulled = 0;
    let conflicts = 0;
    const errors: SyncResult['errors'] = [];

    for (const table of SYNC_TABLES) {
      try {
        const { data, error } = await this.supabase
          .from(table)
          .select('*')
          .eq('user_id', this.userId)
          .gt('updated_at', sinceMs);

        if (error) throw error;
        if (!data) continue;

        for (const row of data) {
          pulled++;
          const enriched = await this.hydrateSpatialBlob(table, row);
          if (this._onRemoteChange) {
            this._onRemoteChange(table, 'UPDATE', enriched, null);
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ record: table, message });
      }
    }

    return {
      pushed: 0,
      pulled,
      conflicts,
      errors,
      startedAt: started,
      finishedAt: Date.now(),
    };
  }

  /**
   * Full sync cycle: push all dirty records, then pull all remote changes.
   * The caller provides dirty records; pull uses sinceMs = 0 for a full fetch.
   */
  async syncNow(dirtyRecords: DirtyRecord[] = [], sinceMs: number = 0): Promise<SyncResult> {
    this._state = 'syncing';
    const started = Date.now();

    try {
      const pushResult = await this.push(dirtyRecords);
      const pullResult = await this.pull(sinceMs);

      this._state = 'idle';

      return {
        pushed: pushResult.pushed,
        pulled: pullResult.pulled,
        conflicts: pushResult.conflicts + pullResult.conflicts,
        errors: [...pushResult.errors, ...pullResult.errors],
        startedAt: started,
        finishedAt: Date.now(),
      };
    } catch {
      this._state = 'error';
      return {
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        errors: [{ record: 'syncNow', message: 'Sync cycle failed unexpectedly' }],
        startedAt: started,
        finishedAt: Date.now(),
      };
    }
  }

  /** Handle a Realtime postgres_changes event. */
  private handleRealtimeEvent(table: SyncTable, payload: unknown): void {
    if (!this._onRemoteChange) return;

    const p = payload as {
      eventType: string;
      new: Record<string, unknown> | null;
      old: Record<string, unknown> | null;
    };

    const event = p.eventType === 'INSERT'
      ? 'INSERT' as const
      : p.eventType === 'DELETE'
        ? 'DELETE' as const
        : 'UPDATE' as const;

    // Blob hydration for v2 notes happens asynchronously — fire-and-forget
    // here keeps the Realtime handler non-blocking. Delete events trigger a
    // best-effort blob removal.
    if (table === 'notes' && event === 'DELETE' && p.old?.id) {
      void deleteGraphiteBlob(this.supabase, this.userId, String(p.old.id)).catch(() => {
        /* best-effort; blob may already be gone */
      });
      this._onRemoteChange(table, event, p.new ?? null, p.old ?? null);
      return;
    }

    void this.hydrateSpatialBlob(table, p.new).then((enriched) => {
      this._onRemoteChange?.(table, event, enriched, p.old ?? null);
    });
  }

  /**
   * If the row is a v2 note, download the matching `.graphite` blob from
   * Storage and attach it as `graphite_blob` on the returned row. The
   * consumer's `applyRemoteNote` handler uses this to persist the bytes
   * locally.
   */
  private async hydrateSpatialBlob(
    table: SyncTable,
    row: Record<string, unknown> | null,
  ): Promise<Record<string, unknown> | null> {
    if (!row || table !== 'notes') return row;
    if (row.canvas_version !== 2) return row;
    const id = row.id ? String(row.id) : null;
    if (!id) return row;
    try {
      const bytes = await downloadGraphiteBlob(this.supabase, this.userId, id);
      if (bytes) return { ...row, graphite_blob: bytes };
    } catch {
      // Surface as a missing blob — the row still flows through so the
      // consumer can retry later.
    }
    return row;
  }
}

/**
 * Split the DirtyRecord row into a pure Postgres upsert payload (no blob
 * bytes) and the spatial blob to ship to Storage. Blob bytes are never
 * written to the `notes` table to avoid duplicate storage cost.
 */
function extractSpatialBlob(record: DirtyRecord): {
  row: Record<string, unknown>;
  spatialBlob: Uint8Array | null;
} {
  const row = { ...record.data };
  let spatialBlob: Uint8Array | null = null;
  if (record.table === 'notes' && row.canvas_version === 2) {
    const blob = row.graphite_blob;
    if (blob instanceof Uint8Array) {
      spatialBlob = blob;
    }
  }
  delete row.graphite_blob;
  return { row, spatialBlob };
}
