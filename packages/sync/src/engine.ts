import type { SyncEngineConfig, SyncResult, SyncState, DirtyRecord } from './types';
import { NotImplementedError } from './errors';

/**
 * SyncEngine — Phase 2 scaffold.
 *
 * All methods except `state` are stubs. Phase 2 will implement push/pull
 * via Supabase Realtime channels scoped to userId, with RLS enforcing
 * `auth.uid() = user_id` on every table.
 */
export class SyncEngine {
  private _state: SyncState = 'disabled';

  constructor(private readonly config: SyncEngineConfig) {
    if (!config.userId) {
      throw new Error('SyncEngine requires a userId from an authenticated session');
    }
  }

  get state(): SyncState {
    return this._state;
  }

  /** Start the sync loop. Listens for Realtime events and pushes dirty records. */
  async start(): Promise<void> {
    throw new NotImplementedError('SyncEngine.start');
  }

  /** Stop the sync loop cleanly. */
  async stop(): Promise<void> {
    throw new NotImplementedError('SyncEngine.stop');
  }

  /** Push all dirty records to Supabase. Returns a SyncResult. */
  async push(_records: DirtyRecord[]): Promise<SyncResult> {
    throw new NotImplementedError('SyncEngine.push');
  }

  /** Pull all remote changes since the last successful sync. */
  async pull(_sinceMs: number): Promise<SyncResult> {
    throw new NotImplementedError('SyncEngine.pull');
  }

  /** Run a full sync cycle: push dirty, pull remote. */
  async syncNow(): Promise<SyncResult> {
    throw new NotImplementedError('SyncEngine.syncNow');
  }
}
