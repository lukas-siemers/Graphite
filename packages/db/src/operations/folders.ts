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
  sort_order: number;
}

function mapFolder(row: RawFolder): Folder {
  return {
    id: row.id,
    notebookId: row.notebook_id,
    parentId: row.parent_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sortOrder: row.sort_order ?? 0,
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
  // Place the new folder at the end within its notebook
  const maxRow = await db.getFirstAsync<{ max_order: number | null }>(
    'SELECT MAX(sort_order) as max_order FROM folders WHERE notebook_id = ?',
    [notebookId],
  );
  const sortOrder = (maxRow?.max_order ?? -1) + 1;
  await db.runAsync(
    'INSERT INTO folders (id, notebook_id, parent_id, name, created_at, updated_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, notebookId, parent, name, now, now, sortOrder],
  );
  return { id, notebookId, parentId: parent, name, createdAt: now, updatedAt: now, sortOrder };
}

export async function getFolders(
  db: SQLiteDatabase,
  notebookId: string,
): Promise<Folder[]> {
  const rows = await db.getAllAsync<RawFolder>(
    'SELECT * FROM folders WHERE notebook_id = ? ORDER BY sort_order ASC, name ASC',
    [notebookId],
  );
  const folders = rows.map(mapFolder);
  // If all sort_orders are 0 (first run after migration), assign stable order by
  // name ASC so existing users see no visual change and have distinct values.
  const allZero = folders.length > 1 && folders.every((f: Folder) => f.sortOrder === 0);
  if (allZero) {
    for (let i = 0; i < folders.length; i++) {
      await db.runAsync('UPDATE folders SET sort_order = ? WHERE id = ?', [i, folders[i].id]);
      folders[i] = { ...folders[i], sortOrder: i };
    }
  }
  return folders;
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

export async function updateFolderSortOrder(
  db: SQLiteDatabase,
  id: string,
  sortOrder: number,
): Promise<void> {
  await db.runAsync('UPDATE folders SET sort_order = ? WHERE id = ?', [sortOrder, id]);
}

export async function deleteFolder(
  db: SQLiteDatabase,
  id: string,
): Promise<void> {
  await db.runAsync('DELETE FROM notes WHERE folder_id = ?', [id]);
  await db.runAsync('DELETE FROM folders WHERE id = ?', [id]);
}
