import type { SQLiteDatabase } from 'expo-sqlite';
import { nanoid } from 'nanoid/non-secure';
import type { Notebook } from '../types';

interface RawNotebook {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  synced_at: number | null;
}

function mapNotebook(row: RawNotebook): Notebook {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at,
  };
}

export async function createNotebook(
  db: SQLiteDatabase,
  name: string,
): Promise<Notebook> {
  const id = nanoid();
  const now = Date.now();
  await db.runAsync(
    'INSERT INTO notebooks (id, name, created_at, updated_at, synced_at) VALUES (?, ?, ?, ?, NULL)',
    [id, name, now, now],
  );
  return { id, name, createdAt: now, updatedAt: now, syncedAt: null };
}

export async function getNotebooks(db: SQLiteDatabase): Promise<Notebook[]> {
  const rows = await db.getAllAsync<RawNotebook>(
    'SELECT * FROM notebooks ORDER BY updated_at DESC',
  );
  return rows.map(mapNotebook);
}

export async function updateNotebook(
  db: SQLiteDatabase,
  id: string,
  name: string,
): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    'UPDATE notebooks SET name = ?, updated_at = ? WHERE id = ?',
    [name, now, id],
  );
}

export async function deleteNotebook(
  db: SQLiteDatabase,
  id: string,
): Promise<void> {
  await db.runAsync('DELETE FROM notes WHERE notebook_id = ?', [id]);
  await db.runAsync('DELETE FROM folders WHERE notebook_id = ?', [id]);
  await db.runAsync('DELETE FROM notebooks WHERE id = ?', [id]);
}
