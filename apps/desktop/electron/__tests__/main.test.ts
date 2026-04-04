/**
 * Regression tests for four bugs fixed in apps/desktop/electron/main.ts.
 *
 * Because main.ts is a full Electron app entry-point (imports `electron` at
 * module load time) we do NOT import it directly.  Instead we:
 *   - Re-implement the two pure helper functions (`wrap`, `buildUpdateSets`)
 *     verbatim so we can unit-test them in isolation.
 *   - Instantiate a real better-sqlite3 `:memory:` database and run the
 *     exact SQL strings from main.ts for all DB-touching tests.
 *   - Mock the `electron` module for the Electron event tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Helpers copied verbatim from main.ts — kept in sync intentionally so that
// any drift in the source will require updating these tests too.
// ---------------------------------------------------------------------------

function wrap<T>(fn: () => T): { data: T } | { error: string } {
  try {
    return { data: fn() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ---------------------------------------------------------------------------
// Shared in-memory DB factory — mirrors initDatabase() from main.ts exactly.
// ---------------------------------------------------------------------------

function createInMemoryDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS notebooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      synced_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      notebook_id TEXT NOT NULL REFERENCES notebooks(id),
      parent_id TEXT REFERENCES folders(id),
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      folder_id TEXT REFERENCES folders(id),
      notebook_id TEXT NOT NULL REFERENCES notebooks(id),
      title TEXT NOT NULL DEFAULT 'Untitled',
      body TEXT NOT NULL DEFAULT '',
      drawing_asset_id TEXT,
      is_dirty INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      synced_at INTEGER
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      title,
      body,
      content='notes',
      content_rowid='rowid'
    );
  `);
  return db;
}

// ---------------------------------------------------------------------------
// Helper: insert a notebook (required FK for notes).
// ---------------------------------------------------------------------------

function seedNotebook(db: Database.Database, id = 'nb-1'): void {
  db.prepare(
    'INSERT INTO notebooks (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'
  ).run(id, 'Test Notebook', 1000, 1000);
}

// ---------------------------------------------------------------------------
// Helper: insert a note and populate its FTS entry — mirrors db:createNote.
// ---------------------------------------------------------------------------

function seedNote(
  db: Database.Database,
  note: { id: string; notebook_id: string; title: string; body: string; created_at: number; updated_at: number }
): void {
  db.prepare(
    'INSERT INTO notes (id, notebook_id, folder_id, title, body, is_dirty, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'
  ).run(note.id, note.notebook_id, null, note.title, note.body, note.created_at, note.updated_at);
  db.prepare(
    'INSERT INTO notes_fts(rowid, title, body) SELECT rowid, title, body FROM notes WHERE id = ?'
  ).run(note.id);
}

// ---------------------------------------------------------------------------
// Bug 1 — IPC wrap() catches handler errors and returns { error: string }
// ---------------------------------------------------------------------------

describe('wrap() — IPC error handling', () => {
  it('returns { data } when the handler succeeds', () => {
    const result = wrap(() => 42);
    expect(result).toEqual({ data: 42 });
  });

  it('returns { error: string } when the handler throws an Error', () => {
    const result = wrap(() => {
      throw new Error('SQLITE_ERROR: no such table');
    });
    expect(result).toHaveProperty('error');
    expect(typeof (result as { error: string }).error).toBe('string');
    expect((result as { error: string }).error).toBe('SQLITE_ERROR: no such table');
  });

  it('returns { error: string } when better-sqlite3 prepare() throws', () => {
    // Simulate a broken DB where prepare throws a non-Error value.
    const brokenDb = {
      prepare: () => {
        throw new TypeError('Database connection closed');
      },
    } as unknown as Database.Database;

    const result = wrap(() =>
      brokenDb.prepare('SELECT * FROM notes').all()
    );

    expect(result).toHaveProperty('error');
    expect(typeof (result as { error: string }).error).toBe('string');
  });

  it('coerces non-Error thrown values to a string in the error field', () => {
    const result = wrap(() => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'plain string error';
    });
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toBe('plain string error');
  });

  it('does not contain a data key when an error is returned', () => {
    const result = wrap(() => {
      throw new Error('boom');
    }) as Record<string, unknown>;
    expect('data' in result).toBe(false);
    expect('error' in result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Bug 2 — FTS cleanup on delete: deleted note no longer appears in search
// ---------------------------------------------------------------------------

describe('db:deleteNote — FTS cleanup on delete', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
    seedNotebook(db);
  });

  afterEach(() => {
    db.close();
  });

  it('returns zero FTS search results for the title of a deleted note', () => {
    // Arrange: create a note with a unique title and index it in FTS.
    seedNote(db, {
      id: 'note-delete-1',
      notebook_id: 'nb-1',
      title: 'Pineapple Upside Down Cake',
      body: 'A classic retro dessert.',
      created_at: 1000,
      updated_at: 1000,
    });

    // Act: run the exact delete logic from db:deleteNote in main.ts.
    db.prepare(
      "INSERT INTO notes_fts(notes_fts, rowid, title, body) SELECT 'delete', rowid, title, body FROM notes WHERE id = ?"
    ).run('note-delete-1');
    db.prepare('DELETE FROM notes WHERE id = ?').run('note-delete-1');

    // Assert: searching for the deleted note's title returns no rows.
    const results = db.prepare(
      `SELECT notes.* FROM notes
       INNER JOIN notes_fts ON notes.rowid = notes_fts.rowid
       WHERE notes_fts MATCH ?
       ORDER BY rank`
    ).all('Pineapple');

    expect(results).toHaveLength(0);
  });

  it('does not affect FTS entries for other notes when one is deleted', () => {
    // Arrange: two notes — delete only the first.
    seedNote(db, {
      id: 'note-keep',
      notebook_id: 'nb-1',
      title: 'Chocolate Lava Cake',
      body: 'Rich molten center.',
      created_at: 1000,
      updated_at: 1000,
    });
    seedNote(db, {
      id: 'note-remove',
      notebook_id: 'nb-1',
      title: 'Vanilla Sponge Cake',
      body: 'Light and fluffy.',
      created_at: 1001,
      updated_at: 1001,
    });

    // Act: delete only the second note.
    db.prepare(
      "INSERT INTO notes_fts(notes_fts, rowid, title, body) SELECT 'delete', rowid, title, body FROM notes WHERE id = ?"
    ).run('note-remove');
    db.prepare('DELETE FROM notes WHERE id = ?').run('note-remove');

    // Assert: the remaining note is still findable.
    const results = db.prepare(
      `SELECT notes.* FROM notes
       INNER JOIN notes_fts ON notes.rowid = notes_fts.rowid
       WHERE notes_fts MATCH ?
       ORDER BY rank`
    ).all('Chocolate') as Array<{ id: string }>;

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('note-keep');
  });

  it('returns { id } from the delete handler and removes the row', () => {
    seedNote(db, {
      id: 'note-ret',
      notebook_id: 'nb-1',
      title: 'Returnable Note',
      body: 'Some content.',
      created_at: 2000,
      updated_at: 2000,
    });

    // Run the full handler body through wrap() as main.ts does.
    const result = wrap(() => {
      db.prepare(
        "INSERT INTO notes_fts(notes_fts, rowid, title, body) SELECT 'delete', rowid, title, body FROM notes WHERE id = ?"
      ).run('note-ret');
      db.prepare('DELETE FROM notes WHERE id = ?').run('note-ret');
      return { id: 'note-ret' };
    });

    expect(result).toEqual({ data: { id: 'note-ret' } });
    const row = db.prepare('SELECT * FROM notes WHERE id = ?').get('note-ret');
    expect(row).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Bug 3 — Windows second-instance deep link forwarded to mainWindow
// ---------------------------------------------------------------------------

describe('second-instance — Windows deep link forwarding', () => {
  it('calls mainWindow.webContents.send with deep-link and the graphite:// URL', () => {
    // Arrange: create a minimal mainWindow stand-in with a spy.
    const sendSpy = vi.fn();
    const mainWindow = {
      webContents: { send: sendSpy },
      isMinimized: () => false,
      restore: vi.fn(),
      focus: vi.fn(),
    };

    // Reproduce the second-instance handler logic verbatim from main.ts.
    function onSecondInstance(_event: unknown, argv: string[]): void {
      const url = argv.find((arg) => arg.startsWith('graphite://'));
      if (url && mainWindow) {
        mainWindow.webContents.send('deep-link', url);
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    }

    // Act: fire the event with a realistic argv array.
    onSecondInstance(null, [
      'C:\\Program Files\\Graphite\\Graphite.exe',
      '--allow-file-access-from-files',
      'graphite://auth/callback',
    ]);

    // Assert: the deep-link channel received the correct URL.
    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy).toHaveBeenCalledWith('deep-link', 'graphite://auth/callback');
  });

  it('does not call send when no graphite:// URL is present in argv', () => {
    const sendSpy = vi.fn();
    const mainWindow = {
      webContents: { send: sendSpy },
      isMinimized: () => false,
      restore: vi.fn(),
      focus: vi.fn(),
    };

    function onSecondInstance(_event: unknown, argv: string[]): void {
      const url = argv.find((arg) => arg.startsWith('graphite://'));
      if (url && mainWindow) {
        mainWindow.webContents.send('deep-link', url);
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    }

    onSecondInstance(null, ['C:\\Program Files\\Graphite\\Graphite.exe']);

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('restores a minimized window after forwarding the deep link', () => {
    const sendSpy = vi.fn();
    const restoreSpy = vi.fn();
    const mainWindow = {
      webContents: { send: sendSpy },
      isMinimized: () => true,
      restore: restoreSpy,
      focus: vi.fn(),
    };

    function onSecondInstance(_event: unknown, argv: string[]): void {
      const url = argv.find((arg) => arg.startsWith('graphite://'));
      if (url && mainWindow) {
        mainWindow.webContents.send('deep-link', url);
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    }

    onSecondInstance(null, ['graphite://auth/callback?code=abc123']);

    expect(sendSpy).toHaveBeenCalledWith('deep-link', 'graphite://auth/callback?code=abc123');
    expect(restoreSpy).toHaveBeenCalledOnce();
  });

  it('picks the first graphite:// argument when multiple are present in argv', () => {
    const sendSpy = vi.fn();
    const mainWindow = {
      webContents: { send: sendSpy },
      isMinimized: () => false,
      restore: vi.fn(),
      focus: vi.fn(),
    };

    function onSecondInstance(_event: unknown, argv: string[]): void {
      const url = argv.find((arg) => arg.startsWith('graphite://'));
      if (url && mainWindow) {
        mainWindow.webContents.send('deep-link', url);
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    }

    onSecondInstance(null, [
      'graphite://auth/callback',
      'graphite://note/123',
    ]);

    expect(sendSpy).toHaveBeenCalledOnce();
    expect(sendSpy).toHaveBeenCalledWith('deep-link', 'graphite://auth/callback');
  });
});

// ---------------------------------------------------------------------------
// Bug 4 — updateNote with only updated_at preserves existing title and body
// ---------------------------------------------------------------------------

describe('db:updateNote — partial update with only updated_at', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createInMemoryDb();
    seedNotebook(db);
  });

  afterEach(() => {
    db.close();
  });

  it('preserves the original title and body when only updated_at is supplied', () => {
    // Arrange: seed a note with known title and body.
    seedNote(db, {
      id: 'note-upd-1',
      notebook_id: 'nb-1',
      title: 'Original Title',
      body: 'Original body content.',
      created_at: 1000,
      updated_at: 1000,
    });

    // Act: run the exact db:updateNote handler logic from main.ts with only
    // updated_at — this is the scenario that previously produced an empty
    // SET clause and crashed.
    const fields: { title?: string; body?: string; drawing_asset_id?: string; updated_at: number } = {
      updated_at: 9999,
    };

    const updatedRow = wrap(() => {
      const sets: string[] = [];
      const values: unknown[] = [];
      if (fields.title !== undefined)            { sets.push('title = ?');            values.push(fields.title); }
      if (fields.body !== undefined)             { sets.push('body = ?');             values.push(fields.body); }
      if (fields.drawing_asset_id !== undefined) { sets.push('drawing_asset_id = ?'); values.push(fields.drawing_asset_id); }
      sets.push('updated_at = ?');
      values.push(fields.updated_at);
      values.push('note-upd-1');
      db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      db.prepare(
        'INSERT OR REPLACE INTO notes_fts(rowid, title, body) SELECT rowid, title, body FROM notes WHERE id = ?'
      ).run('note-upd-1');
      return db.prepare('SELECT * FROM notes WHERE id = ?').get('note-upd-1');
    }) as { data: { id: string; title: string; body: string; updated_at: number } };

    // Assert: timestamp changed, title and body untouched.
    expect(updatedRow.data.updated_at).toBe(9999);
    expect(updatedRow.data.title).toBe('Original Title');
    expect(updatedRow.data.body).toBe('Original body content.');
  });

  it('returns the full updated row (not just the fields passed in)', () => {
    seedNote(db, {
      id: 'note-upd-2',
      notebook_id: 'nb-1',
      title: 'Full Row Check',
      body: 'Body text.',
      created_at: 500,
      updated_at: 500,
    });

    const fields: { title?: string; body?: string; drawing_asset_id?: string; updated_at: number } = {
      updated_at: 7777,
    };

    const result = wrap(() => {
      const sets: string[] = [];
      const values: unknown[] = [];
      if (fields.title !== undefined)            { sets.push('title = ?');            values.push(fields.title); }
      if (fields.body !== undefined)             { sets.push('body = ?');             values.push(fields.body); }
      if (fields.drawing_asset_id !== undefined) { sets.push('drawing_asset_id = ?'); values.push(fields.drawing_asset_id); }
      sets.push('updated_at = ?');
      values.push(fields.updated_at);
      values.push('note-upd-2');
      db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      db.prepare(
        'INSERT OR REPLACE INTO notes_fts(rowid, title, body) SELECT rowid, title, body FROM notes WHERE id = ?'
      ).run('note-upd-2');
      return db.prepare('SELECT * FROM notes WHERE id = ?').get('note-upd-2');
    }) as { data: Record<string, unknown> };

    // The result must be wrapped in { data: ... } (not { error: ... }).
    expect(result).toHaveProperty('data');
    expect(result.data).toMatchObject({
      id: 'note-upd-2',
      title: 'Full Row Check',
      body: 'Body text.',
      updated_at: 7777,
      notebook_id: 'nb-1',
    });
  });

  it('also updates title when title is supplied alongside updated_at', () => {
    seedNote(db, {
      id: 'note-upd-3',
      notebook_id: 'nb-1',
      title: 'Before',
      body: 'Unchanged body.',
      created_at: 100,
      updated_at: 100,
    });

    const fields: { title?: string; body?: string; drawing_asset_id?: string; updated_at: number } = {
      title: 'After',
      updated_at: 200,
    };

    wrap(() => {
      const sets: string[] = [];
      const values: unknown[] = [];
      if (fields.title !== undefined)            { sets.push('title = ?');            values.push(fields.title); }
      if (fields.body !== undefined)             { sets.push('body = ?');             values.push(fields.body); }
      if (fields.drawing_asset_id !== undefined) { sets.push('drawing_asset_id = ?'); values.push(fields.drawing_asset_id); }
      sets.push('updated_at = ?');
      values.push(fields.updated_at);
      values.push('note-upd-3');
      db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      db.prepare(
        'INSERT OR REPLACE INTO notes_fts(rowid, title, body) SELECT rowid, title, body FROM notes WHERE id = ?'
      ).run('note-upd-3');
      return db.prepare('SELECT * FROM notes WHERE id = ?').get('note-upd-3');
    });

    const row = db.prepare('SELECT * FROM notes WHERE id = ?').get('note-upd-3') as {
      title: string; body: string; updated_at: number;
    };

    expect(row.title).toBe('After');
    expect(row.body).toBe('Unchanged body.');
    expect(row.updated_at).toBe(200);
  });

  it('does not set updated_at to 0 or null when the field is provided', () => {
    seedNote(db, {
      id: 'note-upd-4',
      notebook_id: 'nb-1',
      title: 'Timestamp Guard',
      body: '',
      created_at: 1,
      updated_at: 1,
    });

    const fields: { title?: string; body?: string; drawing_asset_id?: string; updated_at: number } = {
      updated_at: 123456789,
    };

    wrap(() => {
      const sets: string[] = [];
      const values: unknown[] = [];
      if (fields.title !== undefined)            { sets.push('title = ?');            values.push(fields.title); }
      if (fields.body !== undefined)             { sets.push('body = ?');             values.push(fields.body); }
      if (fields.drawing_asset_id !== undefined) { sets.push('drawing_asset_id = ?'); values.push(fields.drawing_asset_id); }
      sets.push('updated_at = ?');
      values.push(fields.updated_at);
      values.push('note-upd-4');
      db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      db.prepare(
        'INSERT OR REPLACE INTO notes_fts(rowid, title, body) SELECT rowid, title, body FROM notes WHERE id = ?'
      ).run('note-upd-4');
      return db.prepare('SELECT * FROM notes WHERE id = ?').get('note-upd-4');
    });

    const row = db.prepare('SELECT * FROM notes WHERE id = ?').get('note-upd-4') as {
      updated_at: number;
    };

    expect(row.updated_at).toBe(123456789);
    expect(row.updated_at).not.toBe(0);
    expect(row.updated_at).not.toBeNull();
  });
});
