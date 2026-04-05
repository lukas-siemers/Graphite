import Database from 'better-sqlite3';
import { ALL_MIGRATIONS } from './schema';

/**
 * Creates a fresh in-memory SQLite database and applies all migrations.
 * Use this in tests — never use a real file path.
 */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  for (const sql of ALL_MIGRATIONS) {
    db.exec(sql);
  }

  return db;
}

/**
 * Wraps a better-sqlite3 instance to match expo-sqlite's async API surface
 * (runAsync, getAllAsync, getFirstAsync, execAsync) so operation functions
 * written against expo-sqlite can run in the Node/Vitest test environment.
 */
export function createExpoCompatibleDb(): any {
  const db = createTestDb();
  return {
    execAsync: async (sql: string) => {
      db.exec(sql);
    },
    runAsync: async (sql: string, params: any[] = []) => {
      const stmt = db.prepare(sql);
      const result = stmt.run(...params);
      return { lastInsertRowId: result.lastInsertRowid, changes: result.changes };
    },
    getAllAsync: async <T = any>(sql: string, params: any[] = []): Promise<T[]> => {
      const stmt = db.prepare(sql);
      return stmt.all(...params) as T[];
    },
    getFirstAsync: async <T = any>(sql: string, params: any[] = []): Promise<T | null> => {
      const stmt = db.prepare(sql);
      return (stmt.get(...params) as T) ?? null;
    },
    // better-sqlite3 transactions are synchronous, but we simulate the
    // expo-sqlite async API here. On any thrown error we roll back.
    withTransactionAsync: async (fn: () => Promise<void>) => {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
