import type { SQLiteDatabase } from 'expo-sqlite';
import { ALL_MIGRATIONS } from './schema';

export async function runMigrations(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');

  for (const sql of ALL_MIGRATIONS) {
    await db.execAsync(sql);
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
