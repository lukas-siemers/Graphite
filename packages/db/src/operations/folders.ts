import type { SQLiteDatabase } from 'expo-sqlite';
import { nanoid } from 'nanoid/non-secure';
import type { Folder } from '../types';

interface RawFolder {
  id: string;
  notebook_id: string;
  parent_id: string | null;
  name: string;
  is_dirty: number;
  created_at: number;
  updated_at: number;
  synced_at: number | null;
  sort_order: number;
}

function mapFolder(row: RawFolder): Folder {
  return {
    id: row.id,
    notebookId: row.notebook_id,
    parentId: row.parent_id,
    name: row.name,
    isDirty: row.is_dirty ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at ?? null,
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
    'INSERT INTO folders (id, notebook_id, parent_id, name, is_dirty, created_at, updated_at, synced_at, sort_order) VALUES (?, ?, ?, ?, 1, ?, ?, NULL, ?)',
    [id, notebookId, parent, name, now, now, sortOrder],
  );
  return { id, notebookId, parentId: parent, name, isDirty: 1, createdAt: now, updatedAt: now, syncedAt: null, sortOrder };
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
    'UPDATE folders SET name = ?, updated_at = ?, is_dirty = 1 WHERE id = ?',
    [name, now, id],
  );
}

/**
 * Rename a folder. Dedicated entry point used by inline-rename UX in the
 * sidebar. Updates `updated_at` to the current time. Parameterized - callers
 * must validate / trim `name` upstream.
 */
export async function renameFolder(
  db: SQLiteDatabase,
  id: string,
  name: string,
): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    'UPDATE folders SET name = ?, updated_at = ?, is_dirty = 1 WHERE id = ?',
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

/**
 * Recursively collect the given folder's id and the ids of all descendant
 * (child / grandchild / ...) folders via parent_id chains within a notebook.
 */
async function collectFolderSubtree(
  db: SQLiteDatabase,
  rootId: string,
): Promise<string[]> {
  const all: string[] = [rootId];
  let frontier: string[] = [rootId];
  while (frontier.length > 0) {
    const placeholders = frontier.map(() => '?').join(',');
    const rows = await db.getAllAsync<{ id: string }>(
      `SELECT id FROM folders WHERE parent_id IN (${placeholders})`,
      frontier,
    );
    const next = rows.map((r: { id: string }) => r.id);
    all.push(...next);
    frontier = next;
  }
  return all;
}

/**
 * Count the number of direct+descendant notes and descendant subfolders for
 * a given folder. Used to drive count-aware delete confirmation dialogs.
 */
export async function countFolderContents(
  db: SQLiteDatabase,
  folderId: string,
): Promise<{ folderCount: number; noteCount: number }> {
  const subtree = await collectFolderSubtree(db, folderId);
  const descendantFolderCount = subtree.length - 1; // exclude the root folder itself
  const placeholders = subtree.map(() => '?').join(',');
  const row = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM notes WHERE folder_id IN (${placeholders})`,
    subtree,
  );
  return {
    folderCount: descendantFolderCount,
    noteCount: row?.c ?? 0,
  };
}

/**
 * Cascade-delete a folder, all its descendant subfolders, and every note
 * inside any of them — in a single transaction. Returns the ids that were
 * removed so callers can update in-memory stores without reloading.
 */
export async function deleteFolder(
  db: SQLiteDatabase,
  id: string,
): Promise<{ deletedFolderIds: string[]; deletedNoteIds: string[] }> {
  const deletedFolderIds = await collectFolderSubtree(db, id);
  const placeholders = deletedFolderIds.map(() => '?').join(',');
  const noteRows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM notes WHERE folder_id IN (${placeholders})`,
    deletedFolderIds,
  );
  const deletedNoteIds = noteRows.map((r: { id: string }) => r.id);

  await db.withTransactionAsync(async () => {
    if (deletedNoteIds.length > 0) {
      const noteHolders = deletedNoteIds.map(() => '?').join(',');
      await db.runAsync(
        `DELETE FROM notes WHERE id IN (${noteHolders})`,
        deletedNoteIds,
      );
    }
    // Delete children before parents to satisfy FK constraints.
    for (let i = deletedFolderIds.length - 1; i >= 0; i--) {
      await db.runAsync('DELETE FROM folders WHERE id = ?', [deletedFolderIds[i]]);
    }
  });

  return { deletedFolderIds, deletedNoteIds };
}

// ---------------------------------------------------------------------------
// Sync helpers
// ---------------------------------------------------------------------------

/** Return all folders with is_dirty = 1. */
export async function getDirtyFolders(db: SQLiteDatabase): Promise<Folder[]> {
  const rows = await db.getAllAsync<RawFolder>('SELECT * FROM folders WHERE is_dirty = 1');
  return rows.map(mapFolder);
}

/** Mark a folder as synced (clean). */
export async function markFolderClean(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync(
    'UPDATE folders SET is_dirty = 0, synced_at = ? WHERE id = ?',
    [Date.now(), id],
  );
}

/**
 * Apply a remote folder record to the local DB. Uses last-write-wins
 * conflict resolution based on updated_at.
 */
export async function applyRemoteFolder(
  db: SQLiteDatabase,
  remote: { id: string; notebook_id: string; parent_id: string | null; name: string; sort_order?: number; created_at: number; updated_at: number },
): Promise<void> {
  const local = await db.getFirstAsync<RawFolder>('SELECT * FROM folders WHERE id = ?', [remote.id]);
  if (!local) {
    await db.runAsync(
      'INSERT INTO folders (id, notebook_id, parent_id, name, is_dirty, sort_order, created_at, updated_at, synced_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)',
      [remote.id, remote.notebook_id, remote.parent_id, remote.name, remote.sort_order ?? 0, remote.created_at, remote.updated_at, Date.now()],
    );
  } else if (remote.updated_at >= local.updated_at) {
    await db.runAsync(
      'UPDATE folders SET notebook_id = ?, parent_id = ?, name = ?, sort_order = ?, updated_at = ?, synced_at = ?, is_dirty = 0 WHERE id = ?',
      [remote.notebook_id, remote.parent_id, remote.name, remote.sort_order ?? local.sort_order, remote.updated_at, Date.now(), remote.id],
    );
  }
  // If local is newer, keep local — it is already dirty and will push on next sync.
}
