/**
 * Graphite — Electron main process
 *
 * Rules (from CLAUDE.md):
 * - All Node.js APIs (fs, better-sqlite3, shell) live exclusively in this file.
 * - The renderer is a pure web context — never import Node APIs there.
 * - Expose functionality to the renderer ONLY via contextBridge IPC.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

let db: Database.Database;

function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'graphite.db');
  db = new Database(dbPath);
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
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

function wrap<T>(fn: () => T): { data: T } | { error: string } {
  try {
    return { data: fn() };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function registerIpcHandlers() {
  ipcMain.handle('db:getNotebooks', () =>
    wrap(() => db.prepare('SELECT * FROM notebooks ORDER BY updated_at DESC').all())
  );

  ipcMain.handle('db:createNotebook', (_e, notebook: { id: string; name: string; created_at: number; updated_at: number }) =>
    wrap(() => {
      db.prepare(
        'INSERT INTO notebooks (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)'
      ).run(notebook.id, notebook.name, notebook.created_at, notebook.updated_at);
      return notebook;
    })
  );

  ipcMain.handle('db:getFolders', (_e, notebookId: string) =>
    wrap(() => db.prepare('SELECT * FROM folders WHERE notebook_id = ? ORDER BY name ASC').all(notebookId))
  );

  ipcMain.handle('db:createFolder', (_e, folder: { id: string; notebook_id: string; parent_id?: string; name: string; created_at: number; updated_at: number }) =>
    wrap(() => {
      db.prepare(
        'INSERT INTO folders (id, notebook_id, parent_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(folder.id, folder.notebook_id, folder.parent_id ?? null, folder.name, folder.created_at, folder.updated_at);
      return folder;
    })
  );

  ipcMain.handle('db:getNotes', (_e, notebookId: string) =>
    wrap(() => db.prepare('SELECT * FROM notes WHERE notebook_id = ? ORDER BY updated_at DESC').all(notebookId))
  );

  ipcMain.handle('db:getNote', (_e, id: string) =>
    wrap(() => db.prepare('SELECT * FROM notes WHERE id = ?').get(id))
  );

  ipcMain.handle('db:createNote', (_e, note: { id: string; notebook_id: string; folder_id?: string; title: string; body: string; created_at: number; updated_at: number }) =>
    wrap(() => {
      db.prepare(
        'INSERT INTO notes (id, notebook_id, folder_id, title, body, is_dirty, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'
      ).run(note.id, note.notebook_id, note.folder_id ?? null, note.title, note.body, note.created_at, note.updated_at);
      db.prepare(
        'INSERT INTO notes_fts(rowid, title, body) SELECT rowid, title, body FROM notes WHERE id = ?'
      ).run(note.id);
      return note;
    })
  );

  ipcMain.handle('db:updateNote', (_e, id: string, fields: { title?: string; body?: string; drawing_asset_id?: string; updated_at: number }) =>
    wrap(() => {
      const sets: string[] = [];
      const values: unknown[] = [];
      if (fields.title !== undefined)            { sets.push('title = ?');            values.push(fields.title); }
      if (fields.body !== undefined)             { sets.push('body = ?');             values.push(fields.body); }
      if (fields.drawing_asset_id !== undefined) { sets.push('drawing_asset_id = ?'); values.push(fields.drawing_asset_id); }
      sets.push('updated_at = ?');
      values.push(fields.updated_at);
      if (sets.length === 1) {
        // Only updated_at provided — still a valid update
      }
      values.push(id);
      db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      // Keep FTS in sync
      db.prepare(
        'INSERT OR REPLACE INTO notes_fts(rowid, title, body) SELECT rowid, title, body FROM notes WHERE id = ?'
      ).run(id);
      return db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
    })
  );

  ipcMain.handle('db:deleteNote', (_e, id: string) =>
    wrap(() => {
      // Remove from FTS index before deleting the source row
      db.prepare(
        "INSERT INTO notes_fts(notes_fts, rowid, title, body) SELECT 'delete', rowid, title, body FROM notes WHERE id = ?"
      ).run(id);
      db.prepare('DELETE FROM notes WHERE id = ?').run(id);
      return { id };
    })
  );

  ipcMain.handle('db:searchNotes', (_e, query: string) =>
    wrap(() =>
      db.prepare(
        `SELECT notes.* FROM notes
         INNER JOIN notes_fts ON notes.rowid = notes_fts.rowid
         WHERE notes_fts MATCH ?
         ORDER BY rank`
      ).all(query)
    )
  );
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#1E1E1E',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:8081');
    mainWindow.webContents.openDevTools();
  } else {
    // __dirname is dist/electron/ — web export lands one level up at dist/
    mainWindow.loadFile(path.join(__dirname, '../index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.setAsDefaultProtocolClient('graphite');

// Windows: deep link arrives as a CLI argument on second instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((arg) => arg.startsWith('graphite://'));
    if (url && mainWindow) {
      mainWindow.webContents.send('deep-link', url);
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  initDatabase();
  registerIpcHandlers();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// macOS: deep link arrives via open-url
app.on('open-url', (_event, url) => {
  if (mainWindow) {
    mainWindow.webContents.send('deep-link', url);
  }
});
