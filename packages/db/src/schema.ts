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

// Migration 7 — sort_order for note list reordering
// Adds sort_order INTEGER DEFAULT 0 to notes so the user can reorder notes
// via drag-and-drop in the note list. Existing rows default to 0.
export const ADD_NOTE_SORT_ORDER = `ALTER TABLE notes ADD COLUMN sort_order INTEGER DEFAULT 0;`;

// Migration 8 — tag system
// Tags are auto-extracted from note body (#tag syntax). The tags table stores
// unique tag names; note_tags is the many-to-many join table.
export const CREATE_TAGS = `
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);`;

export const CREATE_NOTE_TAGS = `
CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);`;

// Migration 9 — settings key-value store
// Used for app-level flags such as onboarding_completed. Each row is a
// unique key with a text value.
export const CREATE_SETTINGS = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);`;

// Migration 10 — sync dirty tracking for notebooks and folders
// Adds is_dirty INTEGER DEFAULT 0 and synced_at INTEGER to folders, and
// is_dirty INTEGER DEFAULT 0 to notebooks (synced_at already exists on notebooks).
// Notes already have both columns from the initial schema.
export const ADD_NOTEBOOK_IS_DIRTY = `ALTER TABLE notebooks ADD COLUMN is_dirty INTEGER DEFAULT 0;`;
export const ADD_FOLDER_IS_DIRTY = `ALTER TABLE folders ADD COLUMN is_dirty INTEGER DEFAULT 0;`;
export const ADD_FOLDER_SYNCED_AT = `ALTER TABLE folders ADD COLUMN synced_at INTEGER;`;

// Migration 15 — spatial canvas (.graphite) storage
// Adds three nullable columns to notes for the v2 spatial canvas document model:
//   - graphite_blob:    BLOB of the serialized .graphite ZIP for v2 notes.
//   - canvas_version:   1 for legacy flat canvas_json rows, 2 for spatial blob rows.
//                       Existing rows remain version 1; new rows default to 1 at the
//                       SQL layer and are explicitly set to 2 in createNote().
//   - fts_body:         Pre-computed searchable text extracted from the spatial
//                       document. When present, updateNote() uses it as the FTS
//                       body instead of extracting from body/canvas_json.
// The ALTERs are guarded for idempotency in migrations.ts.
export const ADD_NOTE_GRAPHITE_BLOB = `ALTER TABLE notes ADD COLUMN graphite_blob BLOB;`;
export const ADD_NOTE_CANVAS_VERSION = `ALTER TABLE notes ADD COLUMN canvas_version INTEGER DEFAULT 1;`;
export const ADD_NOTE_FTS_BODY = `ALTER TABLE notes ADD COLUMN fts_body TEXT;`;

export const ALL_MIGRATIONS = [
  CREATE_NOTEBOOKS,
  CREATE_FOLDERS,
  CREATE_NOTES,
  CREATE_NOTES_FTS,
  ADD_CANVAS_JSON,
  ADD_NOTEBOOK_SORT_ORDER,
  ADD_FOLDER_SORT_ORDER,
  ADD_NOTE_SORT_ORDER,
  CREATE_TAGS,
  CREATE_NOTE_TAGS,
  CREATE_SETTINGS,
  ADD_NOTEBOOK_IS_DIRTY,
  ADD_FOLDER_IS_DIRTY,
  ADD_FOLDER_SYNCED_AT,
  ADD_NOTE_GRAPHITE_BLOB,
  ADD_NOTE_CANVAS_VERSION,
  ADD_NOTE_FTS_BODY,
] as const;
