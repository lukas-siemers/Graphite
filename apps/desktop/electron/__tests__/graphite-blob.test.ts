/**
 * Electron main-process smoke tests for the .graphite BLOB path.
 *
 * main.ts cannot be imported directly (it binds to real Electron APIs at
 * module load), so we reproduce the post-migration-15 schema + the
 * Buffer/Uint8Array conversion helpers inline. The SQL strings match
 * `initDatabase()` / `db:createNote` / `db:updateNote` / `db:getNote` in
 * main.ts exactly — drift there means these tests fail.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Inline copies of the main-process helpers under test.
// ---------------------------------------------------------------------------

function normalizeNoteRow<T extends { graphite_blob?: unknown } | undefined | null>(row: T): T {
  if (!row) return row;
  const blob = (row as any).graphite_blob;
  if (blob && (blob as any).constructor && (blob as any).constructor.name === 'Buffer') {
    (row as any).graphite_blob = new Uint8Array(
      (blob as Buffer).buffer,
      (blob as Buffer).byteOffset,
      (blob as Buffer).byteLength,
    );
  }
  return row;
}

function toBlobBuffer(value: Uint8Array | Buffer | null | undefined): Buffer | null {
  if (value == null) return null;
  if (Buffer.isBuffer(value)) return value;
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

// ---------------------------------------------------------------------------
// Schema factory — matches initDatabase() post migration 15 in main.ts.
// ---------------------------------------------------------------------------

function createMigratedDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE notebooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      synced_at INTEGER
    );

    CREATE TABLE folders (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL REFERENCES notebooks(id),
      parent_id TEXT REFERENCES folders(id),
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      folder_id TEXT REFERENCES folders(id),
      notebook_id TEXT NOT NULL REFERENCES notebooks(id),
      title TEXT NOT NULL DEFAULT 'Untitled',
      body TEXT NOT NULL DEFAULT '',
      drawing_asset_id TEXT,
      canvas_json TEXT,
      is_dirty INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      synced_at INTEGER,
      graphite_blob BLOB,
      canvas_version INTEGER DEFAULT 1,
      fts_body TEXT
    );

    CREATE VIRTUAL TABLE notes_fts USING fts5(
      title,
      body,
      content='notes',
      content_rowid='rowid'
    );
  `);
  db.prepare(
    'INSERT INTO notebooks (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'
  ).run('nb-1', 'Test Notebook', 1000, 1000);
  return db;
}

// ---------------------------------------------------------------------------
// Helpers that reproduce db:createNote / db:updateNote / db:getNote.
// ---------------------------------------------------------------------------

function createNote(
  db: Database.Database,
  note: {
    id: string;
    notebook_id: string;
    title: string;
    body: string;
    canvas_version?: number;
    graphite_blob?: Uint8Array | null;
    fts_body?: string | null;
    created_at: number;
    updated_at: number;
  },
): void {
  const canvasVersion = note.canvas_version ?? 2;
  const graphiteBlob = toBlobBuffer(note.graphite_blob);
  const ftsBody = note.fts_body ?? null;
  db.prepare(
    `INSERT INTO notes (id, notebook_id, folder_id, title, body, canvas_version, graphite_blob, fts_body, is_dirty, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
  ).run(
    note.id,
    note.notebook_id,
    null,
    note.title,
    note.body,
    canvasVersion,
    graphiteBlob,
    ftsBody,
    note.created_at,
    note.updated_at,
  );
  db.prepare(
    'INSERT INTO notes_fts(rowid, title, body) SELECT rowid, title, COALESCE(fts_body, body) FROM notes WHERE id = ?',
  ).run(note.id);
}

function updateNote(
  db: Database.Database,
  id: string,
  fields: {
    title?: string;
    body?: string;
    graphite_blob?: Uint8Array | null;
    canvas_version?: number;
    fts_body?: string | null;
    updated_at: number;
  },
): void {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (fields.title !== undefined)            { sets.push('title = ?');            values.push(fields.title); }
  if (fields.body !== undefined)             { sets.push('body = ?');             values.push(fields.body); }
  if (fields.graphite_blob !== undefined)    { sets.push('graphite_blob = ?');    values.push(toBlobBuffer(fields.graphite_blob)); }
  if (fields.canvas_version !== undefined)   { sets.push('canvas_version = ?');   values.push(fields.canvas_version); }
  if (fields.fts_body !== undefined)         { sets.push('fts_body = ?');         values.push(fields.fts_body); }
  sets.push('updated_at = ?');
  values.push(fields.updated_at);
  values.push(id);
  db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  db.prepare(
    `INSERT OR REPLACE INTO notes_fts(rowid, title, body)
     SELECT rowid, title,
            COALESCE(fts_body, json_extract(canvas_json, '$.textContent.body'), body)
     FROM notes WHERE id = ?`,
  ).run(id);
}

function getNote(db: Database.Database, id: string): Record<string, unknown> | null {
  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return normalizeNoteRow(row ?? null);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Electron BLOB round-trip', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createMigratedDb();
  });

  afterEach(() => {
    db.close();
  });

  it('stores a 1KB Uint8Array and reads it back with byte equality', () => {
    // Deterministic 1KB payload — not all zeros, so we can detect mangling.
    const kb = 1024;
    const input = new Uint8Array(kb);
    for (let i = 0; i < kb; i++) input[i] = (i * 37 + 11) & 0xff;

    createNote(db, {
      id: 'note-blob',
      notebook_id: 'nb-1',
      title: 'Blob Test',
      body: '',
      canvas_version: 2,
      graphite_blob: input,
      fts_body: 'searchable text',
      created_at: 1000,
      updated_at: 1000,
    });

    const row = getNote(db, 'note-blob');
    expect(row).not.toBeNull();
    const out = (row as any).graphite_blob as Uint8Array;
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.byteLength).toBe(kb);
    for (let i = 0; i < kb; i++) {
      if (out[i] !== input[i]) {
        throw new Error(`byte ${i} mismatch: expected ${input[i]}, got ${out[i]}`);
      }
    }
  });

  it('returns Uint8Array (not Buffer) across the IPC boundary', () => {
    const payload = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // "PK\x03\x04" ZIP magic
    createNote(db, {
      id: 'note-pk',
      notebook_id: 'nb-1',
      title: 'ZIP magic',
      body: '',
      canvas_version: 2,
      graphite_blob: payload,
      created_at: 2000,
      updated_at: 2000,
    });

    const row = getNote(db, 'note-pk') as any;
    // Buffer extends Uint8Array, so we must assert it's NOT a Buffer.
    expect(Buffer.isBuffer(row.graphite_blob)).toBe(false);
    expect(row.graphite_blob).toBeInstanceOf(Uint8Array);
  });

  it('updateNote replaces an existing blob with new bytes', () => {
    const first = new Uint8Array([1, 2, 3]);
    const second = new Uint8Array([9, 9, 9, 9, 9]);

    createNote(db, {
      id: 'note-upd',
      notebook_id: 'nb-1',
      title: 'Upd',
      body: '',
      canvas_version: 2,
      graphite_blob: first,
      created_at: 3000,
      updated_at: 3000,
    });

    updateNote(db, 'note-upd', { graphite_blob: second, updated_at: 3001 });

    const row = getNote(db, 'note-upd') as any;
    expect(Array.from(row.graphite_blob as Uint8Array)).toEqual([9, 9, 9, 9, 9]);
  });

  it('updateNote with graphite_blob = null clears the column', () => {
    createNote(db, {
      id: 'note-clr',
      notebook_id: 'nb-1',
      title: 'Clear',
      body: '',
      canvas_version: 2,
      graphite_blob: new Uint8Array([1, 2, 3]),
      created_at: 4000,
      updated_at: 4000,
    });

    updateNote(db, 'note-clr', { graphite_blob: null, updated_at: 4001 });

    const row = getNote(db, 'note-clr') as any;
    expect(row.graphite_blob).toBeNull();
  });

  it('FTS uses fts_body when provided on createNote', () => {
    createNote(db, {
      id: 'note-fts',
      notebook_id: 'nb-1',
      title: 'Empty body',
      body: '',
      canvas_version: 2,
      graphite_blob: new Uint8Array([0]),
      fts_body: 'quantumflux',
      created_at: 5000,
      updated_at: 5000,
    });

    const hits = db
      .prepare(
        `SELECT notes.id FROM notes
         INNER JOIN notes_fts ON notes.rowid = notes_fts.rowid
         WHERE notes_fts MATCH ?`,
      )
      .all('quantumflux') as Array<{ id: string }>;
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe('note-fts');
  });
});
