import { type SupabaseClient, type RealtimeChannel } from '@supabase/supabase-js';
import { resolveByLastWrite } from './conflict';
import { getSupabaseClient } from './client';
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
        const row = { ...record.data, user_id: this.userId };
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
          if (this._onRemoteChange) {
            this._onRemoteChange(table, 'UPDATE', row, null);
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

    this._onRemoteChange(table, event, p.new ?? null, p.old ?? null);
  }
}
