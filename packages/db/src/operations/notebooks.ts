import type { SQLiteDatabase } from 'expo-sqlite';
import { nanoid } from 'nanoid/non-secure';
import type { Notebook } from '../types';

interface RawNotebook {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  synced_at: number | null;
  sort_order: number;
}

function mapNotebook(row: RawNotebook): Notebook {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at,
    sortOrder: row.sort_order ?? 0,
  };
}

export async function createNotebook(
  db: SQLiteDatabase,
  name: string,
): Promise<Notebook> {
  const id = nanoid();
  const now = Date.now();
  // Place the new notebook at the end by finding the current max sort_order
  const maxRow = await db.getFirstAsync<{ max_order: number | null }>(
    'SELECT MAX(sort_order) as max_order FROM notebooks',
  );
  const sortOrder = (maxRow?.max_order ?? -1) + 1;
  await db.runAsync(
    'INSERT INTO notebooks (id, name, created_at, updated_at, synced_at, sort_order) VALUES (?, ?, ?, ?, NULL, ?)',
    [id, name, now, now, sortOrder],
  );
  return { id, name, createdAt: now, updatedAt: now, syncedAt: null, sortOrder };
}

export async function getNotebooks(db: SQLiteDatabase): Promise<Notebook[]> {
  const rows = await db.getAllAsync<RawNotebook>(
    'SELECT * FROM notebooks ORDER BY sort_order ASC, created_at ASC',
  );
  const notebooks = rows.map(mapNotebook);
  // If all sort_orders are 0 (first run after migration), assign stable order by
  // created_at so existing users see no visual change and have distinct values.
  const allZero = notebooks.length > 1 && notebooks.every((n: Notebook) => n.sortOrder === 0);
  if (allZero) {
    for (let i = 0; i < notebooks.length; i++) {
      await db.runAsync('UPDATE notebooks SET sort_order = ? WHERE id = ?', [i, notebooks[i].id]);
      notebooks[i] = { ...notebooks[i], sortOrder: i };
    }
  }
  return notebooks;
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

export async function updateNotebookSortOrder(
  db: SQLiteDatabase,
  id: string,
  sortOrder: number,
): Promise<void> {
  await db.runAsync('UPDATE notebooks SET sort_order = ? WHERE id = ?', [sortOrder, id]);
}

/**
 * Count the number of folders and notes contained in a notebook. Used to
 * drive count-aware delete confirmation dialogs.
 */
export async function countNotebookContents(
  db: SQLiteDatabase,
  notebookId: string,
): Promise<{ folderCount: number; noteCount: number }> {
  const f = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM folders WHERE notebook_id = ?',
    [notebookId],
  );
  const n = await db.getFirstAsync<{ c: number }>(
    'SELECT COUNT(*) as c FROM notes WHERE notebook_id = ?',
    [notebookId],
  );
  return { folderCount: f?.c ?? 0, noteCount: n?.c ?? 0 };
}

/**
 * Cascade-delete a notebook, all its folders, and all its notes in a
 * single transaction. Returns the deleted folder and note ids so callers
 * can update in-memory stores without a full reload.
 */
export async function deleteNotebook(
  db: SQLiteDatabase,
  id: string,
): Promise<{ deletedFolderIds: string[]; deletedNoteIds: string[] }> {
  const folderRows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM folders WHERE notebook_id = ?',
    [id],
  );
  const noteRows = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM notes WHERE notebook_id = ?',
    [id],
  );
  const deletedFolderIds = folderRows.map((r: { id: string }) => r.id);
  const deletedNoteIds = noteRows.map((r: { id: string }) => r.id);

  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM notes WHERE notebook_id = ?', [id]);
    await db.runAsync('DELETE FROM folders WHERE notebook_id = ?', [id]);
    await db.runAsync('DELETE FROM notebooks WHERE id = ?', [id]);
  });

  return { deletedFolderIds, deletedNoteIds };
}
