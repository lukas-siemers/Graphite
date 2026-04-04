export const CREATE_NOTEBOOKS = `
CREATE TABLE IF NOT EXISTS notebooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  synced_at INTEGER
);`;

export const CREATE_FOLDERS = `
CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id),
  parent_id TEXT REFERENCES folders(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);`;

export const CREATE_NOTES = `
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
);`;

export const CREATE_NOTES_FTS = `
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title,
  body,
  content='notes',
  content_rowid='rowid'
);`;

// Migration 5 — v1.5 canvas model
// Adds canvas_json (nullable) to notes. Legacy body and drawing_asset_id columns
// are kept as fallback. The FTS index continues to use the title and body columns;
// updateNote() merges canvas textContent.body into the FTS body field at write time.
export const ADD_CANVAS_JSON = `ALTER TABLE notes ADD COLUMN canvas_json TEXT;`;

// Migration 6 — sort_order for sidebar reordering
// Adds sort_order INTEGER DEFAULT 0 to notebooks and folders so the user can
// reorder items in the sidebar. Existing rows default to 0 and will be assigned
// stable order values on first load via initSortOrder helpers.
export const ADD_NOTEBOOK_SORT_ORDER = `ALTER TABLE notebooks ADD COLUMN sort_order INTEGER DEFAULT 0;`;
export const ADD_FOLDER_SORT_ORDER = `ALTER TABLE folders ADD COLUMN sort_order INTEGER DEFAULT 0;`;

export const ALL_MIGRATIONS = [
  CREATE_NOTEBOOKS,
  CREATE_FOLDERS,
  CREATE_NOTES,
  CREATE_NOTES_FTS,
  ADD_CANVAS_JSON,
  ADD_NOTEBOOK_SORT_ORDER,
  ADD_FOLDER_SORT_ORDER,
] as const;
