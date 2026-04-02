import type { SQLiteDatabase } from 'expo-sqlite';
import { nanoid } from 'nanoid/non-secure';
import type { Folder } from '../types';

interface RawFolder {
  id: string;
  notebook_id: string;
  parent_id: string | null;
  name: string;
  created_at: number;
  updated_at: number;
}

function mapFolder(row: RawFolder): Folder {
  return {
    id: row.id,
    notebookId: row.notebook_id,
    parentId: row.parent_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function createFolder(
  db: SQLiteDatabase,
  notebookId: string,
  name: string,
  parentId?: string,
): Promise<Folder> {
  const id = nanoid();
  const now = Date.now();
  const parent = parentId ?? null;
  await db.runAsync(
    'INSERT INTO folders (id, notebook_id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [id, notebookId, parent, name, now, now],
  );
  return { id, notebookId, parentId: parent, name, createdAt: now, updatedAt: now };
}

export async function getFolders(
  db: SQLiteDatabase,
  notebookId: string,
): Promise<Folder[]> {
  const rows = await db.getAllAsync<RawFolder>(
    'SELECT * FROM folders WHERE notebook_id = ? ORDER BY name ASC',
    [notebookId],
  );
  return rows.map(mapFolder);
}

export async function updateFolder(
  db: SQLiteDatabase,
  id: string,
  name: string,
): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    'UPDATE folders SET name = ?, updated_at = ? WHERE id = ?',
    [name, now, id],
  );
}

export async function deleteFolder(
  db: SQLiteDatabase,
  id: string,
): Promise<void> {
  await db.runAsync('DELETE FROM notes WHERE folder_id = ?', [id]);
  await db.runAsync('DELETE FROM folders WHERE id = ?', [id]);
}
