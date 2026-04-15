import type { SQLiteDatabase } from 'expo-sqlite';

/**
 * Tombstones for records that were hard-deleted locally and still need to
 * be propagated to Supabase. Survives app restarts so offline-then-online
 * deletes always sync. Inserted by deleteNote / deleteFolder /
 * deleteNotebook BEFORE the hard delete, cleared by the sync engine after
 * a successful Supabase DELETE on the remote row.
 *
 * `table_name` is 'notes' | 'folders' | 'notebooks' — the Supabase table
 * the tombstone targets. Supabase's ON DELETE CASCADE removes nested
 * folders / notes automatically when a parent row is deleted, so tombstones
 * are only emitted for the top-level delete the user explicitly asked for.
 */
export type TombstoneTable = 'notes' | 'folders' | 'notebooks';

export interface PendingDelete {
  id: string;
  tableName: TombstoneTable;
  deletedAt: number;
}

interface RawPendingDelete {
  id: string;
  table_name: TombstoneTable;
  deleted_at: number;
}

/**
 * Record a tombstone so the sync engine will later DELETE the corresponding
 * Supabase row. Safe to call inside the same transaction as the hard-delete.
 * Uses INSERT OR REPLACE so repeated delete clicks on the same id/table
 * just refresh deleted_at rather than erroring on the composite PK.
 */
export async function insertPendingDelete(
  db: SQLiteDatabase,
  id: string,
  tableName: TombstoneTable,
): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO pending_deletes (id, table_name, deleted_at) VALUES (?, ?, ?)',
    [id, tableName, Date.now()],
  );
}

/**
 * Fetch all outstanding tombstones. Sync engine calls this during each
 * push cycle and iterates the result list. Ordering by deleted_at lets
 * the engine process older deletes first (rarely matters, but keeps
 * behavior deterministic under replay).
 */
export async function getPendingDeletes(
  db: SQLiteDatabase,
): Promise<PendingDelete[]> {
  const rows = await db.getAllAsync<RawPendingDelete>(
    'SELECT id, table_name, deleted_at FROM pending_deletes ORDER BY deleted_at ASC',
  );
  return rows.map((r) => ({
    id: r.id,
    tableName: r.table_name,
    deletedAt: r.deleted_at,
  }));
}

/**
 * Clear a single tombstone after the Supabase DELETE succeeds. The
 * composite PK (id, table_name) prevents one note's tombstone from
 * cancelling a folder's tombstone with the same id (unlikely, but
 * the nanoid collision cost is zero).
 */
export async function clearPendingDelete(
  db: SQLiteDatabase,
  id: string,
  tableName: TombstoneTable,
): Promise<void> {
  await db.runAsync(
    'DELETE FROM pending_deletes WHERE id = ? AND table_name = ?',
    [id, tableName],
  );
}
