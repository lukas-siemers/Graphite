import type { SQLiteDatabase } from 'expo-sqlite';
import { nanoid } from 'nanoid/non-secure';
import type { Note } from '../types';

interface RawNote {
  id: string;
  folder_id: string | null;
  notebook_id: string;
  title: string;
  body: string;
  drawing_asset_id: string | null;
  is_dirty: number;
  created_at: number;
  updated_at: number;
  synced_at: number | null;
}

function mapNote(row: RawNote): Note {
  return {
    id: row.id,
    folderId: row.folder_id,
    notebookId: row.notebook_id,
    title: row.title,
    body: row.body,
    drawingAssetId: row.drawing_asset_id,
    isDirty: row.is_dirty,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at,
  };
}

export async function createNote(
  db: SQLiteDatabase,
  notebookId: string,
  folderId?: string,
): Promise<Note> {
  const id = nanoid();
  const now = Date.now();
  const folder = folderId ?? null;
  await db.runAsync(
    `INSERT INTO notes
       (id, folder_id, notebook_id, title, body, drawing_asset_id, is_dirty, created_at, updated_at, synced_at)
     VALUES (?, ?, ?, 'Untitled', '', NULL, 0, ?, ?, NULL)`,
    [id, folder, notebookId, now, now],
  );
  const inserted = await db.getFirstAsync<{ rowid: number }>(
    'SELECT rowid FROM notes WHERE id = ?',
    [id],
  );
  if (inserted) {
    await db.runAsync(
      `INSERT INTO notes_fts(rowid, title, body) VALUES (?, 'Untitled', '')`,
      [inserted.rowid],
    );
  }
  return {
    id,
    folderId: folder,
    notebookId,
    title: 'Untitled',
    body: '',
    drawingAssetId: null,
    isDirty: 0,
    createdAt: now,
    updatedAt: now,
    syncedAt: null,
  };
}

export async function getNotes(
  db: SQLiteDatabase,
  notebookId: string,
  folderId?: string | null,
): Promise<Note[]> {
  let rows: RawNote[];
  if (folderId === undefined || folderId === null) {
    rows = await db.getAllAsync<RawNote>(
      'SELECT * FROM notes WHERE notebook_id = ? ORDER BY updated_at DESC',
      [notebookId],
    );
  } else {
    rows = await db.getAllAsync<RawNote>(
      'SELECT * FROM notes WHERE notebook_id = ? AND folder_id = ? ORDER BY updated_at DESC',
      [notebookId, folderId],
    );
  }
  return rows.map(mapNote);
}

export async function getNote(
  db: SQLiteDatabase,
  id: string,
): Promise<Note | null> {
  const rows = await db.getAllAsync<RawNote>(
    'SELECT * FROM notes WHERE id = ? LIMIT 1',
    [id],
  );
  if (rows.length === 0) return null;
  return mapNote(rows[0]);
}

export async function updateNote(
  db: SQLiteDatabase,
  id: string,
  patch: { title?: string; body?: string; drawingAssetId?: string | null },
): Promise<void> {
  const now = Date.now();
  // Read the current row (including rowid) before mutating so we can issue the
  // FTS5 'delete' command with the old title/body values.
  const before = await db.getFirstAsync<{ rowid: number; title: string; body: string }>(
    'SELECT rowid, title, body FROM notes WHERE id = ?',
    [id],
  );

  if (patch.title !== undefined && patch.body !== undefined) {
    await db.runAsync(
      'UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?',
      [patch.title, patch.body, now, id],
    );
  } else if (patch.title !== undefined) {
    await db.runAsync(
      'UPDATE notes SET title = ?, updated_at = ? WHERE id = ?',
      [patch.title, now, id],
    );
  } else if (patch.body !== undefined) {
    await db.runAsync(
      'UPDATE notes SET body = ?, updated_at = ? WHERE id = ?',
      [patch.body, now, id],
    );
  }

  if (patch.drawingAssetId !== undefined) {
    await db.runAsync(
      'UPDATE notes SET drawing_asset_id = ?, updated_at = ? WHERE id = ?',
      [patch.drawingAssetId, now, id],
    );
  }

  if (before) {
    // Remove the old FTS entry using the FTS5 'delete' command.
    await db.runAsync(
      `INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', ?, ?, ?)`,
      [before.rowid, before.title, before.body],
    );
    // Read updated title/body then insert the new FTS entry.
    const after = await db.getFirstAsync<{ title: string; body: string }>(
      'SELECT title, body FROM notes WHERE id = ?',
      [id],
    );
    if (after) {
      await db.runAsync(
        `INSERT INTO notes_fts(rowid, title, body) VALUES(?, ?, ?)`,
        [before.rowid, after.title, after.body],
      );
    }
  }
}

export async function deleteNote(
  db: SQLiteDatabase,
  id: string,
): Promise<void> {
  await db.runAsync('DELETE FROM notes WHERE id = ?', [id]);
}

export async function searchNotes(
  db: SQLiteDatabase,
  notebookId: string,
  query: string,
): Promise<Note[]> {
  // Escape special FTS5 characters and append * for prefix matching
  const escaped = query.replace(/["]/g, '""');
  const ftsQuery = `"${escaped}"*`;
  const rows = await db.getAllAsync<RawNote>(
    `SELECT n.* FROM notes n
     JOIN notes_fts ON notes_fts.rowid = n.rowid
     WHERE notes_fts MATCH ? AND n.notebook_id = ?
     ORDER BY rank`,
    [ftsQuery, notebookId],
  );
  return rows.map(mapNote);
}
