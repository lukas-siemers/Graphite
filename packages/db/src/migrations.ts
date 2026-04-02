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

export async function initDatabase(): Promise<SQLiteDatabase> {
  if (_db) return _db;

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
