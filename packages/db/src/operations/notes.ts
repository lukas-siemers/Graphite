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
  graphite_blob: Uint8Array | Buffer | null;
  canvas_version: number | null;
  fts_body: string | null;
  is_dirty: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
  synced_at: number | null;
}

function toUint8Array(value: Uint8Array | Buffer | null | undefined): Uint8Array | null {
  if (value == null) return null;
  // better-sqlite3 returns Buffer (a Uint8Array subclass); expo-sqlite returns
  // Uint8Array. Re-wrap as a plain Uint8Array view so callers always see a
  // consistent type across runtimes.
  if ((value as any).constructor && (value as any).constructor.name === 'Buffer') {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return value as Uint8Array;
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
    graphiteBlob: toUint8Array(row.graphite_blob),
    canvasVersion: row.canvas_version ?? 1,
    ftsBody: row.fts_body,
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
       (id, folder_id, notebook_id, title, body, drawing_asset_id, canvas_version, graphite_blob, fts_body, is_dirty, sort_order, created_at, updated_at, synced_at)
     VALUES (?, ?, ?, 'Untitled', '', NULL, 2, NULL, NULL, 1, ?, ?, ?, NULL)`,
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
    graphiteBlob: null,
    canvasVersion: 2,
    ftsBody: null,
    isDirty: 1,
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
    graphiteBlob?: Uint8Array | null;
    canvasVersion?: number;
    ftsBody?: string | null;
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
        'UPDATE notes SET title = ?, body = ?, is_dirty = 1 WHERE id = ?',
        [patch.title, patch.body, id],
      );
    } else {
      await db.runAsync(
        'UPDATE notes SET title = ?, body = ?, is_dirty = 1, updated_at = ? WHERE id = ?',
        [patch.title, patch.body, now, id],
      );
    }
  } else if (patch.title !== undefined) {
    if (skipTs) {
      await db.runAsync(
        'UPDATE notes SET title = ?, is_dirty = 1 WHERE id = ?',
        [patch.title, id],
      );
    } else {
      await db.runAsync(
        'UPDATE notes SET title = ?, is_dirty = 1, updated_at = ? WHERE id = ?',
        [patch.title, now, id],
      );
    }
  } else if (patch.body !== undefined) {
    if (skipTs) {
      await db.runAsync(
        'UPDATE notes SET body = ?, is_dirty = 1 WHERE id = ?',
        [patch.body, id],
      );
    } else {
      await db.runAsync(
        'UPDATE notes SET body = ?, is_dirty = 1, updated_at = ? WHERE id = ?',
        [patch.body, now, id],
      );
    }
  }

  if (patch.drawingAssetId !== undefined) {
    if (skipTs) {
      await db.runAsync(
        'UPDATE notes SET drawing_asset_id = ?, is_dirty = 1 WHERE id = ?',
        [patch.drawingAssetId, id],
      );
    } else {
      await db.runAsync(
        'UPDATE notes SET drawing_asset_id = ?, is_dirty = 1, updated_at = ? WHERE id = ?',
        [patch.drawingAssetId, now, id],
      );
    }
  }

  if (patch.canvasJson !== undefined) {
    if (skipTs) {
      await db.runAsync(
        'UPDATE notes SET canvas_json = ?, is_dirty = 1 WHERE id = ?',
        [patch.canvasJson, id],
      );
    } else {
      await db.runAsync(
        'UPDATE notes SET canvas_json = ?, is_dirty = 1, updated_at = ? WHERE id = ?',
        [patch.canvasJson, now, id],
      );
    }
  }

  if (patch.graphiteBlob !== undefined) {
    if (skipTs) {
      await db.runAsync(
        'UPDATE notes SET graphite_blob = ?, is_dirty = 1 WHERE id = ?',
        [patch.graphiteBlob, id],
      );
    } else {
      await db.runAsync(
        'UPDATE notes SET graphite_blob = ?, is_dirty = 1, updated_at = ? WHERE id = ?',
        [patch.graphiteBlob, now, id],
      );
    }
  }

  if (patch.canvasVersion !== undefined) {
    if (skipTs) {
      await db.runAsync(
        'UPDATE notes SET canvas_version = ?, is_dirty = 1 WHERE id = ?',
        [patch.canvasVersion, id],
      );
    } else {
      await db.runAsync(
        'UPDATE notes SET canvas_version = ?, is_dirty = 1, updated_at = ? WHERE id = ?',
        [patch.canvasVersion, now, id],
      );
    }
  }

  if (patch.ftsBody !== undefined) {
    if (skipTs) {
      await db.runAsync(
        'UPDATE notes SET fts_body = ?, is_dirty = 1 WHERE id = ?',
        [patch.ftsBody, id],
      );
    } else {
      await db.runAsync(
        'UPDATE notes SET fts_body = ?, is_dirty = 1, updated_at = ? WHERE id = ?',
        [patch.ftsBody, now, id],
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
    // Precedence for the FTS body column:
    //   1. fts_body — caller-provided pre-computed text from spatial canvas
    //      extraction. Used as-is.
    //   2. canvas_json textContent.body merged with legacy body — the existing
    //      v1 dual-write path.
    //   3. body — plain legacy note body.
    const after = await db.getFirstAsync<{
      title: string;
      body: string;
      canvas_json: string | null;
      fts_body: string | null;
    }>(
      'SELECT title, body, canvas_json, fts_body FROM notes WHERE id = ?',
      [id],
    );
    if (after) {
      let ftsBody: string;
      if (after.fts_body !== null) {
        ftsBody = after.fts_body;
      } else {
        let canvasText = '';
        if (after.canvas_json) {
          const extracted = await db.getFirstAsync<{ canvas_body: string | null }>(
            `SELECT json_extract(canvas_json, '$.textContent.body') AS canvas_body FROM notes WHERE id = ?`,
            [id],
          );
          canvasText = extracted?.canvas_body ?? '';
        }
        ftsBody = canvasText ? `${after.body}\n${canvasText}`.trim() : after.body;
      }
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
  // Build 109: emit a tombstone BEFORE the hard delete so the sync engine
  // can propagate the delete to Supabase. Without this, the local row
  // vanishes and there's no record left for the push cycle to act on —
  // Supabase ends up with zombie rows forever.
  await db.runAsync(
    'INSERT OR REPLACE INTO pending_deletes (id, table_name, deleted_at) VALUES (?, ?, ?)',
    [id, 'notes', Date.now()],
  );
  await db.runAsync('DELETE FROM notes WHERE id = ?', [id]);
}

export async function moveNote(
  db: SQLiteDatabase,
  noteId: string,
  folderId: string | null,
): Promise<{ noteId: string; folderId: string | null; updated_at: number }> {
  const updated_at = Date.now();
  await db.runAsync(
    'UPDATE notes SET folder_id = ?, updated_at = ?, is_dirty = 1 WHERE id = ?',
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
    'UPDATE notes SET notebook_id = ?, folder_id = ?, sort_order = ?, updated_at = ?, is_dirty = 1 WHERE id = ?',
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

// ---------------------------------------------------------------------------
// Sync helpers
// ---------------------------------------------------------------------------

/** Return all notes with is_dirty = 1. */
export async function getDirtyNotes(db: SQLiteDatabase): Promise<Note[]> {
  const rows = await db.getAllAsync<RawNote>('SELECT * FROM notes WHERE is_dirty = 1');
  return rows.map(mapNote);
}

/** Mark a note as synced (clean). */
export async function markNoteClean(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync(
    'UPDATE notes SET is_dirty = 0, synced_at = ? WHERE id = ?',
    [Date.now(), id],
  );
}

/**
 * Apply a remote note record to the local DB. Uses last-write-wins
 * conflict resolution based on updated_at. Also maintains the FTS5 index.
 */
export async function applyRemoteNote(
  db: SQLiteDatabase,
  remote: {
    id: string;
    folder_id: string | null;
    notebook_id: string;
    title: string;
    body: string;
    canvas_json?: string | null;
    graphite_blob?: Uint8Array | null;
    canvas_version?: number | null;
    fts_body?: string | null;
    sort_order?: number;
    created_at: number;
    updated_at: number;
  },
): Promise<void> {
  const local = await db.getFirstAsync<RawNote>('SELECT * FROM notes WHERE id = ?', [remote.id]);
  // Preserve the existing local canvas_version when the remote omits it
  // (older payloads didn't include it). For new inserts with no remote value,
  // default to 2 — v2 is the current canvas model and defaulting to 1 was
  // silently downgrading v2 notes on pull in builds 75-77.
  const canvasVersion =
    remote.canvas_version ?? (local?.canvas_version ?? 2);
  const graphiteBlob = remote.graphite_blob ?? null;
  const ftsBody = remote.fts_body ?? null;
  // The FTS body column mirrors the updateNote() precedence: caller-provided
  // fts_body wins, otherwise fall back to body.
  const ftsIndexBody = ftsBody !== null ? ftsBody : remote.body;

  if (!local) {
    // New note from another device — insert locally as clean.
    await db.runAsync(
      `INSERT INTO notes (id, folder_id, notebook_id, title, body, canvas_json, graphite_blob, canvas_version, fts_body, is_dirty, sort_order, created_at, updated_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      [
        remote.id,
        remote.folder_id,
        remote.notebook_id,
        remote.title,
        remote.body,
        remote.canvas_json ?? null,
        graphiteBlob,
        canvasVersion,
        ftsBody,
        remote.sort_order ?? 0,
        remote.created_at,
        remote.updated_at,
        Date.now(),
      ],
    );
    // Populate FTS index for the new row.
    const inserted = await db.getFirstAsync<{ rowid: number }>(
      'SELECT rowid FROM notes WHERE id = ?',
      [remote.id],
    );
    if (inserted) {
      await db.runAsync(
        'INSERT INTO notes_fts(rowid, title, body) VALUES (?, ?, ?)',
        [inserted.rowid, remote.title, ftsIndexBody],
      );
    }
  } else if (remote.updated_at >= local.updated_at) {
    // Remote wins — update local row and rebuild FTS entry.
    const before = await db.getFirstAsync<{ rowid: number; title: string; body: string }>(
      'SELECT rowid, title, body FROM notes WHERE id = ?',
      [remote.id],
    );
    await db.runAsync(
      `UPDATE notes SET folder_id = ?, notebook_id = ?, title = ?, body = ?, canvas_json = ?,
       graphite_blob = ?, canvas_version = ?, fts_body = ?,
       sort_order = ?, updated_at = ?, synced_at = ?, is_dirty = 0 WHERE id = ?`,
      [
        remote.folder_id,
        remote.notebook_id,
        remote.title,
        remote.body,
        remote.canvas_json ?? null,
        graphiteBlob,
        canvasVersion,
        ftsBody,
        remote.sort_order ?? local.sort_order,
        remote.updated_at,
        Date.now(),
        remote.id,
      ],
    );
    // Maintain FTS5 index.
    if (before) {
      await db.runAsync(
        `INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', ?, ?, ?)`,
        [before.rowid, before.title, before.body],
      );
      await db.runAsync(
        'INSERT INTO notes_fts(rowid, title, body) VALUES(?, ?, ?)',
        [before.rowid, remote.title, ftsIndexBody],
      );
    }
  }
  // If local is newer, keep local — it is already dirty and will push on next sync.
}
