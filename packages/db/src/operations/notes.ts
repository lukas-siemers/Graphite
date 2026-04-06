import type { SQLiteDatabase } from 'expo-sqlite';
import { nanoid } from 'nanoid/non-secure';
import type { Note } from '../types';
import { fuzzyScore } from '../fuzzy-score';

interface RawNote {
  id: string;
  folder_id: string | null;
  notebook_id: string;
  title: string;
  body: string;
  drawing_asset_id: string | null;
  canvas_json: string | null;
  is_dirty: number;
  sort_order: number;
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
    canvasJson: row.canvas_json,
    isDirty: row.is_dirty,
    sortOrder: row.sort_order,
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
  // Compute next sort_order for this folder/notebook bucket so new notes do
  // not all collide at sort_order=0. Scope the MAX lookup to the same bucket
  // createNote is inserting into: matching notebook AND matching folder_id
  // (treating NULL as its own bucket for top-level notes).
  const maxRow =
    folder === null
      ? await db.getFirstAsync<{ max_order: number | null }>(
          'SELECT MAX(sort_order) as max_order FROM notes WHERE notebook_id = ? AND folder_id IS NULL',
          [notebookId],
        )
      : await db.getFirstAsync<{ max_order: number | null }>(
          'SELECT MAX(sort_order) as max_order FROM notes WHERE notebook_id = ? AND folder_id = ?',
          [notebookId, folder],
        );
  const sortOrder = (maxRow?.max_order ?? -1) + 1;
  await db.runAsync(
    `INSERT INTO notes
       (id, folder_id, notebook_id, title, body, drawing_asset_id, is_dirty, sort_order, created_at, updated_at, synced_at)
     VALUES (?, ?, ?, 'Untitled', '', NULL, 0, ?, ?, ?, NULL)`,
    [id, folder, notebookId, sortOrder, now, now],
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
    canvasJson: null,
    isDirty: 0,
    sortOrder,
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
      'SELECT * FROM notes WHERE notebook_id = ? ORDER BY sort_order ASC, updated_at DESC',
      [notebookId],
    );
  } else {
    rows = await db.getAllAsync<RawNote>(
      'SELECT * FROM notes WHERE notebook_id = ? AND folder_id = ? ORDER BY sort_order ASC, updated_at DESC',
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
  patch: {
    title?: string;
    body?: string;
    drawingAssetId?: string | null;
    canvasJson?: string | null;
    skipTimestamp?: boolean;
  },
): Promise<void> {
  const now = Date.now();
  const skipTs = patch.skipTimestamp === true;
  // Read the current row (including rowid) before mutating so we can issue the
  // FTS5 'delete' command with the old title/body values.
  const before = await db.getFirstAsync<{ rowid: number; title: string; body: string }>(
    'SELECT rowid, title, body FROM notes WHERE id = ?',
    [id],
  );

  if (patch.title !== undefined && patch.body !== undefined) {
    if (skipTs) {
      await db.runAsync(
        'UPDATE notes SET title = ?, body = ? WHERE id = ?',
        [patch.title, patch.body, id],
      );
    } else {
      await db.runAsync(
        'UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?',
        [patch.title, patch.body, now, id],
      );
    }
  } else if (patch.title !== undefined) {
    if (skipTs) {
      await db.runAsync(
        'UPDATE notes SET title = ? WHERE id = ?',
        [patch.title, id],
      );
    } else {
      await db.runAsync(
        'UPDATE notes SET title = ?, updated_at = ? WHERE id = ?',
        [patch.title, now, id],
      );
    }
  } else if (patch.body !== undefined) {
    if (skipTs) {
      await db.runAsync(
        'UPDATE notes SET body = ? WHERE id = ?',
        [patch.body, id],
      );
    } else {
      await db.runAsync(
        'UPDATE notes SET body = ?, updated_at = ? WHERE id = ?',
        [patch.body, now, id],
      );
    }
  }

  if (patch.drawingAssetId !== undefined) {
    if (skipTs) {
      await db.runAsync(
        'UPDATE notes SET drawing_asset_id = ? WHERE id = ?',
        [patch.drawingAssetId, id],
      );
    } else {
      await db.runAsync(
        'UPDATE notes SET drawing_asset_id = ?, updated_at = ? WHERE id = ?',
        [patch.drawingAssetId, now, id],
      );
    }
  }

  if (patch.canvasJson !== undefined) {
    if (skipTs) {
      await db.runAsync(
        'UPDATE notes SET canvas_json = ? WHERE id = ?',
        [patch.canvasJson, id],
      );
    } else {
      await db.runAsync(
        'UPDATE notes SET canvas_json = ?, updated_at = ? WHERE id = ?',
        [patch.canvasJson, now, id],
      );
    }
  }

  if (before) {
    // Remove the old FTS entry using the FTS5 'delete' command.
    await db.runAsync(
      `INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', ?, ?, ?)`,
      [before.rowid, before.title, before.body],
    );
    // Read updated title and body for the new FTS entry.
    // When canvas_json is present, merge its textContent.body into the indexed
    // body text so that canvas prose is searchable via the existing FTS table.
    const after = await db.getFirstAsync<{ title: string; body: string; canvas_json: string | null }>(
      'SELECT title, body, canvas_json FROM notes WHERE id = ?',
      [id],
    );
    if (after) {
      // Extract canvas text body; fall back to empty string when absent.
      let canvasText = '';
      if (after.canvas_json) {
        const extracted = await db.getFirstAsync<{ canvas_body: string | null }>(
          `SELECT json_extract(canvas_json, '$.textContent.body') AS canvas_body FROM notes WHERE id = ?`,
          [id],
        );
        canvasText = extracted?.canvas_body ?? '';
      }
      // Combine legacy body with canvas text so both are searchable.
      const ftsBody = canvasText ? `${after.body}\n${canvasText}`.trim() : after.body;
      await db.runAsync(
        `INSERT INTO notes_fts(rowid, title, body) VALUES(?, ?, ?)`,
        [before.rowid, after.title, ftsBody],
      );
    }
  }
}

export async function deleteNote(
  db: SQLiteDatabase,
  id: string,
): Promise<void> {
  // Clean up the FTS5 entry before dropping the row. The FTS table is declared
  // with content='notes' but we manage inserts/deletes manually (no triggers),
  // so we must issue the FTS5 'delete' command ourselves to avoid orphan rows
  // piling up in the index.
  const before = await db.getFirstAsync<{ rowid: number; title: string; body: string }>(
    'SELECT rowid, title, body FROM notes WHERE id = ?',
    [id],
  );
  if (before) {
    await db.runAsync(
      `INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', ?, ?, ?)`,
      [before.rowid, before.title, before.body],
    );
  }
  await db.runAsync('DELETE FROM notes WHERE id = ?', [id]);
}

export async function moveNote(
  db: SQLiteDatabase,
  noteId: string,
  folderId: string | null,
): Promise<{ noteId: string; folderId: string | null; updated_at: number }> {
  const updated_at = Date.now();
  await db.runAsync(
    'UPDATE notes SET folder_id = ?, updated_at = ? WHERE id = ?',
    [folderId, updated_at, noteId],
  );
  // Note: FTS5 manual maintenance is intentionally skipped here. The FTS index
  // only stores title + body, neither of which change during a folder move,
  // so there's nothing to re-index. See updateNote/deleteNote for the FTS
  // maintenance pattern when title/body do change.
  return { noteId, folderId, updated_at };
}

export async function updateNoteSortOrder(
  db: SQLiteDatabase,
  id: string,
  sortOrder: number,
): Promise<void> {
  await db.runAsync('UPDATE notes SET sort_order = ? WHERE id = ?', [sortOrder, id]);
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

export async function moveNoteToNotebook(
  db: SQLiteDatabase,
  noteId: string,
  targetNotebookId: string,
  targetFolderId: string | null = null,
): Promise<void> {
  const updatedAt = Date.now();
  const maxRow = targetFolderId === null
    ? await db.getFirstAsync<{ next: number }>(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM notes WHERE notebook_id = ? AND folder_id IS NULL',
        [targetNotebookId],
      )
    : await db.getFirstAsync<{ next: number }>(
        'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM notes WHERE notebook_id = ? AND folder_id = ?',
        [targetNotebookId, targetFolderId],
      );
  const sortOrder = (maxRow as any)?.next ?? 0;
  await db.runAsync(
    'UPDATE notes SET notebook_id = ?, folder_id = ?, sort_order = ?, updated_at = ? WHERE id = ?',
    [targetNotebookId, targetFolderId, sortOrder, updatedAt, noteId],
  );
}

/**
 * Enhanced three-tier search:
 *   1. FTS5 prefix match (fast)
 *   2. LIKE substring fallback when FTS5 returns nothing
 *   3. Client-side fuzzy scoring on all results for relevance ranking
 */
export async function searchNotesEnhanced(
  db: SQLiteDatabase,
  notebookId: string,
  query: string,
): Promise<Note[]> {
  if (!query.trim()) return [];

  const trimmed = query.trim();

  // Tier 1: FTS5 prefix match
  const escaped = trimmed.replace(/["]/g, '""');
  const ftsQuery = `"${escaped}"*`;
  let rows = await db.getAllAsync<RawNote>(
    `SELECT n.* FROM notes n
     JOIN notes_fts ON notes_fts.rowid = n.rowid
     WHERE notes_fts MATCH ? AND n.notebook_id = ?
     ORDER BY rank`,
    [ftsQuery, notebookId],
  );

  // Tier 2: LIKE substring fallback
  if (rows.length === 0) {
    const likePattern = `%${trimmed}%`;
    rows = await db.getAllAsync<RawNote>(
      `SELECT * FROM notes
       WHERE notebook_id = ? AND (title LIKE ? OR body LIKE ?)
       ORDER BY updated_at DESC LIMIT 50`,
      [notebookId, likePattern, likePattern],
    );
  }

  const notes = rows.map(mapNote);

  // Tier 3: fuzzy score and sort
  const scored = notes.map((note) => ({
    note,
    score: fuzzyScore(trimmed, note.title + ' ' + note.body),
  }));
  scored.sort((a, b) => b.score - a.score);

  return scored.map((s) => s.note);
}
