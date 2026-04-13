import type { SQLiteDatabase } from 'expo-sqlite';
import { ALL_MIGRATIONS } from './schema';

async function tableHasColumn(
  db: SQLiteDatabase,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const escapedTableName = tableName.replace(/'/g, "''");
  const columns = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info('${escapedTableName}')`,
  );
  return columns.some((column) => column.name === columnName);
}

async function applyMigration(db: SQLiteDatabase, sql: string): Promise<void> {
  if (
    sql === 'ALTER TABLE notes ADD COLUMN canvas_json TEXT;' &&
    (await tableHasColumn(db, 'notes', 'canvas_json'))
  ) {
    return;
  }

  if (
    sql === 'ALTER TABLE notebooks ADD COLUMN sort_order INTEGER DEFAULT 0;' &&
    (await tableHasColumn(db, 'notebooks', 'sort_order'))
  ) {
    return;
  }

  if (
    sql === 'ALTER TABLE folders ADD COLUMN sort_order INTEGER DEFAULT 0;' &&
    (await tableHasColumn(db, 'folders', 'sort_order'))
  ) {
    return;
  }

  if (
    sql === 'ALTER TABLE notes ADD COLUMN sort_order INTEGER DEFAULT 0;' &&
    (await tableHasColumn(db, 'notes', 'sort_order'))
  ) {
    return;
  }

  if (
    sql === 'ALTER TABLE notebooks ADD COLUMN is_dirty INTEGER DEFAULT 0;' &&
    (await tableHasColumn(db, 'notebooks', 'is_dirty'))
  ) {
    return;
  }

  if (
    sql === 'ALTER TABLE folders ADD COLUMN is_dirty INTEGER DEFAULT 0;' &&
    (await tableHasColumn(db, 'folders', 'is_dirty'))
  ) {
    return;
  }

  if (
    sql === 'ALTER TABLE folders ADD COLUMN synced_at INTEGER;' &&
    (await tableHasColumn(db, 'folders', 'synced_at'))
  ) {
    return;
  }

  if (
    sql === 'ALTER TABLE notes ADD COLUMN graphite_blob BLOB;' &&
    (await tableHasColumn(db, 'notes', 'graphite_blob'))
  ) {
    return;
  }

  if (
    sql === 'ALTER TABLE notes ADD COLUMN canvas_version INTEGER DEFAULT 1;' &&
    (await tableHasColumn(db, 'notes', 'canvas_version'))
  ) {
    return;
  }

  if (
    sql === 'ALTER TABLE notes ADD COLUMN fts_body TEXT;' &&
    (await tableHasColumn(db, 'notes', 'fts_body'))
  ) {
    return;
  }

  await db.execAsync(sql);
}

export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');

  // Older TestFlight builds applied migrations before user_version tracking
  // existed. Those installs can have the latest columns while still reporting
  // version 0, so ALTER migrations must be idempotent.
  const versionRow = await db.getFirstAsync<{ user_version: number }>(
    'PRAGMA user_version',
  );
  const currentVersion = versionRow?.user_version ?? 0;

  for (let i = currentVersion; i < ALL_MIGRATIONS.length; i++) {
    await applyMigration(db, ALL_MIGRATIONS[i]);
  }

  // Stamp the new version so the next launch skips these migrations.
  if (ALL_MIGRATIONS.length > currentVersion) {
    await db.execAsync(`PRAGMA user_version = ${ALL_MIGRATIONS.length}`);
  }
}

let _db: SQLiteDatabase | null = null;

// ---------------------------------------------------------------------------
// Web no-op database
// On web (Electron dev / browser preview), expo-sqlite's WASM worker cannot
// be bundled by Metro. We return a no-op DB so initDatabase() completes and
// the UI renders. All data operations return empty results — no persistence.
// ---------------------------------------------------------------------------
const noopDb: SQLiteDatabase = {
  execAsync: async () => {},
  runAsync: async () => ({ lastInsertRowId: 0, changes: 0 }) as any,
  getFirstAsync: async () => null,
  getAllAsync: async () => [],
  prepareAsync: async () => ({
    executeAsync: async () => ({
      lastInsertRowId: 0,
      changes: 0,
      getAllAsync: async () => [],
      getFirstAsync: async () => null,
    }) as any,
    finalizeAsync: async () => {},
  }) as any,
  closeAsync: async () => {},
  withTransactionAsync: async (fn: () => Promise<void>) => fn(),
  withExclusiveTransactionAsync: async (fn: () => Promise<void>) => fn(),
  isInTransaction: false,
  databasePath: '',
} as unknown as SQLiteDatabase;

export async function initDatabase(): Promise<SQLiteDatabase> {
  if (_db) return _db;

  // Skip expo-sqlite on web — its WASM worker cannot load in the Metro dev
  // server. The no-op DB lets the UI mount without persistence.
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    _db = noopDb;
    return _db;
  }

  // Lazy import so this module can be imported in tests without Expo
  const { openDatabaseAsync } = await import('expo-sqlite');
  const db = await openDatabaseAsync('graphite.db');
  await runMigrations(db);
  _db = db;
  return db;
}

export function getDatabase(): SQLiteDatabase {
  if (!_db) throw new Error('Database not initialized. Call initDatabase() first.');
  return _db;
}
