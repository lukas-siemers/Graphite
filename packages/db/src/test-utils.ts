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
