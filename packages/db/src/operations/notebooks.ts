import type { SQLiteDatabase } from 'expo-sqlite';
import { nanoid } from 'nanoid/non-secure';
import {
  assignYPositions,
  chunksFromMarkdown,
  createEmptySpatialCanvas,
  extractSearchableText,
  serializeToGraphite,
} from '@graphite/canvas';
import type { Notebook, Note } from '../types';

interface RawNotebook {
  id: string;
  name: string;
  is_dirty: number;
  created_at: number;
  updated_at: number;
  synced_at: number | null;
  sort_order: number;
}

function mapNotebook(row: RawNotebook): Notebook {
  return {
    id: row.id,
    name: row.name,
    isDirty: row.is_dirty ?? 0,
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
    'INSERT INTO notebooks (id, name, is_dirty, created_at, updated_at, synced_at, sort_order) VALUES (?, ?, 1, ?, ?, NULL, ?)',
    [id, name, now, now, sortOrder],
  );
  return { id, name, isDirty: 1, createdAt: now, updatedAt: now, syncedAt: null, sortOrder };
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
    'UPDATE notebooks SET name = ?, updated_at = ?, is_dirty = 1 WHERE id = ?',
    [name, now, id],
  );
}

/**
 * Rename a notebook. Dedicated entry point used by inline-rename UX in the
 * sidebar. Updates `updated_at` to the current time. Parameterized - callers
 * must validate / trim `name` upstream.
 */
export async function renameNotebook(
  db: SQLiteDatabase,
  id: string,
  name: string,
): Promise<void> {
  const now = Date.now();
  await db.runAsync(
    'UPDATE notebooks SET name = ?, updated_at = ?, is_dirty = 1 WHERE id = ?',
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

// ---------------------------------------------------------------------------
// Sample notebook seeding (onboarding)
// ---------------------------------------------------------------------------

const SAMPLE_NOTES: Array<{ title: string; body: string }> = [
  {
    title: 'Welcome to Graphite',
    body: `# Welcome to Graphite

Graphite is a markdown note-taking app built for speed and simplicity.

- Write in **Markdown** with live syntax highlighting
- Organize notes in **notebooks** and **folders**
- Draw with **Apple Pencil** on iPad
- Export notes as **Markdown** or **PDF**

This is your first notebook. Feel free to edit or delete these sample notes.`,
  },
  {
    title: 'Markdown Cheatsheet',
    body: `# Markdown Cheatsheet

## Text formatting
- **Bold** with double asterisks
- *Italic* with single asterisks
- ~~Strikethrough~~ with double tildes

## Headings
Use # for H1, ## for H2, ### for H3

## Code
Inline code with single backticks

## Lists
- Bullet lists with dashes
1. Numbered lists with numbers

## Links
[Link text](https://example.com)`,
  },
  {
    title: 'Tips and Tricks',
    body: `# Tips and Tricks

- **Double-tap** a folder or notebook name to rename it
- **Swipe left** on a note to delete it
- **Long-press** a note to move it between folders
- Use **#tags** in your notes to organize by topic
- The search bar supports **fuzzy matching** — typos are OK
- Export any note as Markdown or PDF from the editor header`,
  },
];

/**
 * Seed a "Getting Started" notebook with 3 sample notes.
 * Idempotent — if a notebook named "Getting Started" already exists,
 * this function is a no-op and returns the existing notebook.
 */
export async function seedSampleNotebook(
  db: SQLiteDatabase,
): Promise<Notebook> {
  // Idempotency: check if already seeded
  const existing = await db.getFirstAsync<RawNotebook>(
    'SELECT * FROM notebooks WHERE name = ?',
    ['Getting Started'],
  );
  if (existing) {
    return mapNotebook(existing);
  }

  const nb = await createNotebook(db, 'Getting Started');
  const now = Date.now();

  for (let i = 0; i < SAMPLE_NOTES.length; i++) {
    const { title, body } = SAMPLE_NOTES[i];
    const noteId = nanoid();
    // Build a v2 SpatialCanvasDocument from the sample markdown so onboarding
    // lands on the same storage model as normal note creation (canvas_version
    // = 2 + graphite_blob populated). The legacy `body` column stays empty —
    // FTS and the editor read from graphite_blob / fts_body.
    const chunks = chunksFromMarkdown(body);
    const blocks = assignYPositions(chunks, 24, 16);
    const doc = { ...createEmptySpatialCanvas(), blocks };
    const graphiteBlob = await serializeToGraphite(doc);
    const ftsBody = extractSearchableText(doc);
    await db.runAsync(
      `INSERT INTO notes
         (id, folder_id, notebook_id, title, body, drawing_asset_id, canvas_version, graphite_blob, fts_body, is_dirty, sort_order, created_at, updated_at, synced_at)
       VALUES (?, NULL, ?, ?, '', NULL, 2, ?, ?, 0, ?, ?, ?, NULL)`,
      [noteId, nb.id, title, graphiteBlob, ftsBody, i, now, now],
    );
    // Populate FTS index — searchable text comes from extractSearchableText,
    // not the (now empty) legacy body column.
    const inserted = await db.getFirstAsync<{ rowid: number }>(
      'SELECT rowid FROM notes WHERE id = ?',
      [noteId],
    );
    if (inserted) {
      await db.runAsync(
        'INSERT INTO notes_fts(rowid, title, body) VALUES (?, ?, ?)',
        [inserted.rowid, title, ftsBody],
      );
    }
  }

  return nb;
}

// ---------------------------------------------------------------------------
// Sync helpers
// ---------------------------------------------------------------------------

/** Return all notebooks with is_dirty = 1. */
export async function getDirtyNotebooks(db: SQLiteDatabase): Promise<Notebook[]> {
  const rows = await db.getAllAsync<RawNotebook>('SELECT * FROM notebooks WHERE is_dirty = 1');
  return rows.map(mapNotebook);
}

/** Mark a notebook as synced (clean). */
export async function markNotebookClean(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync(
    'UPDATE notebooks SET is_dirty = 0, synced_at = ? WHERE id = ?',
    [Date.now(), id],
  );
}

/**
 * Apply a remote notebook record to the local DB. Uses last-write-wins
 * conflict resolution based on updated_at.
 */
export async function applyRemoteNotebook(
  db: SQLiteDatabase,
  remote: { id: string; name: string; sort_order?: number; created_at: number; updated_at: number },
): Promise<void> {
  const local = await db.getFirstAsync<RawNotebook>('SELECT * FROM notebooks WHERE id = ?', [remote.id]);
  if (!local) {
    await db.runAsync(
      'INSERT INTO notebooks (id, name, is_dirty, sort_order, created_at, updated_at, synced_at) VALUES (?, ?, 0, ?, ?, ?, ?)',
      [remote.id, remote.name, remote.sort_order ?? 0, remote.created_at, remote.updated_at, Date.now()],
    );
  } else if (remote.updated_at >= local.updated_at) {
    await db.runAsync(
      'UPDATE notebooks SET name = ?, sort_order = ?, updated_at = ?, synced_at = ?, is_dirty = 0 WHERE id = ?',
      [remote.name, remote.sort_order ?? local.sort_order, remote.updated_at, Date.now(), remote.id],
    );
  }
  // If local is newer, keep local — it is already dirty and will push on next sync.
}
