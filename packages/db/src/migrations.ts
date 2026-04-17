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
// On non-Electron web (browser preview), expo-sqlite's WASM worker cannot
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

// ---------------------------------------------------------------------------
// Electron IPC database adapter
//
// When running inside Electron, window.graphite.sql is exposed by the preload
// script. This adapter implements the SQLiteDatabase interface by forwarding
// all SQL operations to the main process's better-sqlite3 instance via IPC.
// This lets ALL existing @graphite/db operations and migrations work unchanged
// on desktop — they call db.runAsync / db.getAllAsync etc. which transparently
// route through IPC to real persistent storage.
// ---------------------------------------------------------------------------

interface ElectronSqlBridge {
  exec: (sql: string) => Promise<{ ok?: boolean; error?: string }>;
  run: (sql: string, params?: unknown[]) => Promise<{
    ok?: boolean;
    error?: string;
    lastInsertRowId?: number;
    changes?: number;
  }>;
  getAll: (sql: string, params?: unknown[]) => Promise<{
    ok?: boolean;
    error?: string;
    rows?: unknown[];
  }>;
  getFirst: (sql: string, params?: unknown[]) => Promise<{
    ok?: boolean;
    error?: string;
    row?: unknown;
  }>;
}

function getElectronSql(): ElectronSqlBridge | null {
  if (typeof window !== 'undefined' && (window as any).graphite?.sql) {
    return (window as any).graphite.sql as ElectronSqlBridge;
  }
  return null;
}

function createElectronDb(sql: ElectronSqlBridge): SQLiteDatabase {
  return {
    execAsync: async (statement: string) => {
      const result = await sql.exec(statement);
      if (result.error) throw new Error(result.error);
    },

    runAsync: async (statement: string, params?: unknown[]) => {
      // expo-sqlite accepts params as rest args or an array; normalise to array.
      const p = Array.isArray(params) ? params : params !== undefined ? [params] : [];
      const result = await sql.run(statement, p);
      if (result.error) throw new Error(result.error);
      return { lastInsertRowId: result.lastInsertRowId ?? 0, changes: result.changes ?? 0 } as any;
    },

    getFirstAsync: async <T = unknown>(statement: string, params?: unknown[]): Promise<T | null> => {
      const p = Array.isArray(params) ? params : params !== undefined ? [params] : [];
      const result = await sql.getFirst(statement, p);
      if (result.error) throw new Error(result.error);
      return (result.row ?? null) as T | null;
    },

    getAllAsync: async <T = unknown>(statement: string, params?: unknown[]): Promise<T[]> => {
      const p = Array.isArray(params) ? params : params !== undefined ? [params] : [];
      const result = await sql.getAll(statement, p);
      if (result.error) throw new Error(result.error);
      return (result.rows ?? []) as T[];
    },

    withTransactionAsync: async (fn: () => Promise<void>) => {
      await sql.exec('BEGIN');
      try {
        await fn();
        await sql.exec('COMMIT');
      } catch (e) {
        await sql.exec('ROLLBACK');
        throw e;
      }
    },

    withExclusiveTransactionAsync: async (fn: () => Promise<void>) => {
      await sql.exec('BEGIN EXCLUSIVE');
      try {
        await fn();
        await sql.exec('COMMIT');
      } catch (e) {
        await sql.exec('ROLLBACK');
        throw e;
      }
    },

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
    isInTransaction: false,
    databasePath: 'electron-ipc',
  } as unknown as SQLiteDatabase;
}

export async function initDatabase(): Promise<SQLiteDatabase> {
  if (_db) return _db;

  // Electron: use IPC bridge to better-sqlite3 in the main process.
  // This check MUST come before the generic web check below.
  const electronSql = getElectronSql();
  if (electronSql) {
    const electronDb = createElectronDb(electronSql);
    await runMigrations(electronDb);
    _db = electronDb;
    return _db;
  }

  // Web (non-Electron browser preview): no-op DB, no persistence.
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    _db = noopDb;
    return _db;
  }

  // Native: use expo-sqlite
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
