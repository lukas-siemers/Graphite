import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from '../test-utils';

describe('schema migrations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('applies all migrations without throwing', () => {
    // If createTestDb() didn't throw, migrations succeeded.
    // Query sqlite_master as a sanity check.
    const result = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table'").get() as { count: number };
    expect(result.count).toBeGreaterThan(0);
  });

  it('notebooks table exists with correct columns: id, name, created_at, updated_at, synced_at, sort_order', () => {
    const columns = db.prepare("PRAGMA table_info('notebooks')").all() as Array<{ name: string }>;
    const names = columns.map((c) => c.name);
    expect(names).toContain('id');
    expect(names).toContain('name');
    expect(names).toContain('created_at');
    expect(names).toContain('updated_at');
    expect(names).toContain('synced_at');
    expect(names).toContain('sort_order');
    expect(names).toHaveLength(6);
  });

  it('folders table exists with correct columns: id, notebook_id, parent_id, name, created_at, updated_at, sort_order', () => {
    const columns = db.prepare("PRAGMA table_info('folders')").all() as Array<{ name: string }>;
    const names = columns.map((c) => c.name);
    expect(names).toContain('id');
    expect(names).toContain('notebook_id');
    expect(names).toContain('parent_id');
    expect(names).toContain('name');
    expect(names).toContain('created_at');
    expect(names).toContain('updated_at');
    expect(names).toContain('sort_order');
    expect(names).toHaveLength(7);
  });

  it('notes table exists with correct columns: id, folder_id, notebook_id, title, body, drawing_asset_id, is_dirty, created_at, updated_at, synced_at, canvas_json', () => {
    const columns = db.prepare("PRAGMA table_info('notes')").all() as Array<{ name: string }>;
    const names = columns.map((c) => c.name);
    expect(names).toContain('id');
    expect(names).toContain('folder_id');
    expect(names).toContain('notebook_id');
    expect(names).toContain('title');
    expect(names).toContain('body');
    expect(names).toContain('drawing_asset_id');
    expect(names).toContain('is_dirty');
    expect(names).toContain('created_at');
    expect(names).toContain('updated_at');
    expect(names).toContain('synced_at');
    expect(names).toContain('canvas_json');
    expect(names).toHaveLength(11);
  });

  it('ADD_NOTEBOOK_SORT_ORDER migration adds sort_order column to notebooks', () => {
    // The column must exist after all migrations have been applied on a fresh DB.
    const columns = db.prepare("PRAGMA table_info('notebooks')").all() as Array<{ name: string }>;
    const names = columns.map((c) => c.name);
    expect(names).toContain('sort_order');
  });

  it('ADD_FOLDER_SORT_ORDER migration adds sort_order column to folders', () => {
    // The column must exist after all migrations have been applied on a fresh DB.
    const columns = db.prepare("PRAGMA table_info('folders')").all() as Array<{ name: string }>;
    const names = columns.map((c) => c.name);
    expect(names).toContain('sort_order');
  });

  it('notes_fts virtual table exists', () => {
    const result = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notes_fts'")
      .get() as { name: string } | undefined;
    expect(result).toBeDefined();
    expect(result!.name).toBe('notes_fts');
  });

  it('notes default title is Untitled', () => {
    db.prepare(
      "INSERT INTO notebooks (id, name, created_at, updated_at) VALUES ('nb-1', 'Work', 1700000000000, 1700000000000)"
    ).run();
    db.prepare(
      "INSERT INTO notes (id, notebook_id, created_at, updated_at) VALUES ('n-1', 'nb-1', 1700000000000, 1700000000000)"
    ).run();
    const note = db.prepare("SELECT title FROM notes WHERE id = 'n-1'").get() as { title: string };
    expect(note.title).toBe('Untitled');
  });

  it('notes default body is empty string', () => {
    db.prepare(
      "INSERT INTO notebooks (id, name, created_at, updated_at) VALUES ('nb-1', 'Work', 1700000000000, 1700000000000)"
    ).run();
    db.prepare(
      "INSERT INTO notes (id, notebook_id, created_at, updated_at) VALUES ('n-1', 'nb-1', 1700000000000, 1700000000000)"
    ).run();
    const note = db.prepare("SELECT body FROM notes WHERE id = 'n-1'").get() as { body: string };
    expect(note.body).toBe('');
  });

  it('notes default is_dirty is 0', () => {
    db.prepare(
      "INSERT INTO notebooks (id, name, created_at, updated_at) VALUES ('nb-1', 'Work', 1700000000000, 1700000000000)"
    ).run();
    db.prepare(
      "INSERT INTO notes (id, notebook_id, created_at, updated_at) VALUES ('n-1', 'nb-1', 1700000000000, 1700000000000)"
    ).run();
    const note = db.prepare("SELECT is_dirty FROM notes WHERE id = 'n-1'").get() as { is_dirty: number };
    expect(note.is_dirty).toBe(0);
  });

  it('foreign key: inserting a note with nonexistent notebook_id throws', () => {
    expect(() => {
      db.prepare(
        "INSERT INTO notes (id, notebook_id, created_at, updated_at) VALUES ('n-orphan', 'nb-does-not-exist', 1700000000000, 1700000000000)"
      ).run();
    }).toThrow();
  });

  it('can insert and retrieve a notebook', () => {
    db.prepare(
      "INSERT INTO notebooks (id, name, created_at, updated_at, synced_at) VALUES ('nb-1', 'Work', 1700000000000, 1700000000000, NULL)"
    ).run();
    const row = db.prepare("SELECT * FROM notebooks WHERE id = 'nb-1'").get() as {
      id: string;
      name: string;
      created_at: number;
      updated_at: number;
      synced_at: number | null;
    };
    expect(row.id).toBe('nb-1');
    expect(row.name).toBe('Work');
    expect(row.created_at).toBe(1700000000000);
    expect(row.updated_at).toBe(1700000000000);
    expect(row.synced_at).toBeNull();
  });

  it('can insert and retrieve a folder', () => {
    db.prepare(
      "INSERT INTO notebooks (id, name, created_at, updated_at) VALUES ('nb-1', 'Work', 1700000000000, 1700000000000)"
    ).run();
    db.prepare(
      "INSERT INTO folders (id, notebook_id, parent_id, name, created_at, updated_at) VALUES ('f-1', 'nb-1', NULL, 'Projects', 1700000000000, 1700000000000)"
    ).run();
    const row = db.prepare("SELECT * FROM folders WHERE id = 'f-1'").get() as {
      id: string;
      notebook_id: string;
      parent_id: string | null;
      name: string;
      created_at: number;
      updated_at: number;
    };
    expect(row.id).toBe('f-1');
    expect(row.notebook_id).toBe('nb-1');
    expect(row.parent_id).toBeNull();
    expect(row.name).toBe('Projects');
    expect(row.created_at).toBe(1700000000000);
    expect(row.updated_at).toBe(1700000000000);
  });

  it('can insert and retrieve a note', () => {
    db.prepare(
      "INSERT INTO notebooks (id, name, created_at, updated_at) VALUES ('nb-1', 'Work', 1700000000000, 1700000000000)"
    ).run();
    db.prepare(
      "INSERT INTO folders (id, notebook_id, parent_id, name, created_at, updated_at) VALUES ('f-1', 'nb-1', NULL, 'Projects', 1700000000000, 1700000000000)"
    ).run();
    db.prepare(`
      INSERT INTO notes (id, folder_id, notebook_id, title, body, drawing_asset_id, is_dirty, created_at, updated_at, synced_at)
      VALUES ('n-1', 'f-1', 'nb-1', 'My Note', '# Hello', NULL, 0, 1700000000000, 1700000000000, NULL)
    `).run();
    const row = db.prepare("SELECT * FROM notes WHERE id = 'n-1'").get() as {
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
    };
    expect(row.id).toBe('n-1');
    expect(row.folder_id).toBe('f-1');
    expect(row.notebook_id).toBe('nb-1');
    expect(row.title).toBe('My Note');
    expect(row.body).toBe('# Hello');
    expect(row.drawing_asset_id).toBeNull();
    expect(row.is_dirty).toBe(0);
    expect(row.created_at).toBe(1700000000000);
    expect(row.updated_at).toBe(1700000000000);
    expect(row.synced_at).toBeNull();
  });
});
