/**
 * Graphite — Electron main process
 *
 * Rules (from CLAUDE.md):
 * - All Node.js APIs (fs, better-sqlite3, shell) live exclusively in this file.
 * - The renderer is a pure web context — never import Node APIs there.
 * - Expose functionality to the renderer ONLY via contextBridge IPC.
 */

import { app, BrowserWindow, dialog, ipcMain, protocol, net } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import Database from 'better-sqlite3';
import { autoUpdater } from 'electron-updater';

// ---------------------------------------------------------------------------
// Custom protocol for serving the Expo web export in production.
//
// Expo Router reads window.location.pathname to resolve routes. When loaded
// via file:// the pathname is the full filesystem path (C:/Users/...) which
// matches no route. Serving through a custom protocol gives Expo Router
// clean paths (/ for root, /(main) for the main layout, etc.).
//
// Must be registered BEFORE app.whenReady().
// ---------------------------------------------------------------------------
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'graphite-app',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

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
      canvas_json TEXT,
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

  ipcMain.handle('db:updateNote', (_e, id: string, fields: { title?: string; body?: string; drawing_asset_id?: string; canvas_json?: string | null; updated_at: number }) =>
    wrap(() => {
      const sets: string[] = [];
      const values: unknown[] = [];
      if (fields.title !== undefined)            { sets.push('title = ?');            values.push(fields.title); }
      if (fields.body !== undefined)             { sets.push('body = ?');             values.push(fields.body); }
      if (fields.drawing_asset_id !== undefined) { sets.push('drawing_asset_id = ?'); values.push(fields.drawing_asset_id); }
      if (fields.canvas_json !== undefined)       { sets.push('canvas_json = ?');       values.push(fields.canvas_json); }
      sets.push('updated_at = ?');
      values.push(fields.updated_at);
      if (sets.length === 1) {
        // Only updated_at provided — still a valid update
      }
      values.push(id);
      db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
      // Keep FTS in sync — prefer extracted text from canvas_json when present
      db.prepare(
        `INSERT OR REPLACE INTO notes_fts(rowid, title, body)
         SELECT rowid, title, COALESCE(json_extract(canvas_json, '$.textContent.body'), body)
         FROM notes WHERE id = ?`
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

  ipcMain.handle('db:deleteFolder', (_e, id: string) =>
    wrap(() => {
      // Clean up FTS entries for all notes in this folder before deleting them
      const notes = db.prepare('SELECT rowid, title, body FROM notes WHERE folder_id = ?').all(id) as Array<{ rowid: number; title: string; body: string }>;
      const deleteFts = db.prepare("INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', ?, ?, ?)");
      for (const note of notes) {
        deleteFts.run(note.rowid, note.title, note.body);
      }
      db.prepare('DELETE FROM notes WHERE folder_id = ?').run(id);
      db.prepare('DELETE FROM folders WHERE id = ?').run(id);
      return { id };
    })
  );

  ipcMain.handle('db:deleteNotebook', (_e, id: string) =>
    wrap(() => {
      // Clean up FTS entries for all notes in this notebook before deleting them
      const notes = db.prepare('SELECT rowid, title, body FROM notes WHERE notebook_id = ?').all(id) as Array<{ rowid: number; title: string; body: string }>;
      const deleteFts = db.prepare("INSERT INTO notes_fts(notes_fts, rowid, title, body) VALUES('delete', ?, ?, ?)");
      for (const note of notes) {
        deleteFts.run(note.rowid, note.title, note.body);
      }
      db.prepare('DELETE FROM notes WHERE notebook_id = ?').run(id);
      db.prepare('DELETE FROM folders WHERE notebook_id = ?').run(id);
      db.prepare('DELETE FROM notebooks WHERE id = ?').run(id);
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
    // Load via the custom graphite-app:// protocol so Expo Router sees
    // clean URL paths (/) instead of file:// filesystem paths.
    mainWindow.loadURL('graphite-app://app/');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Auto-updater
// ---------------------------------------------------------------------------

function initAutoUpdater() {
  if (process.env.NODE_ENV === 'development') return;

  autoUpdater.on('update-available', (info) => {
    void info; // suppress unused-variable warning
    // Update metadata is logged by electron-updater internally
  });

  autoUpdater.on('update-downloaded', () => {
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Update ready',
        message: 'A new version of Graphite has been downloaded. Restart to apply the update.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          autoUpdater.quitAndInstall();
        }
      })
      .catch(() => {
        // Dialog dismissed by OS (e.g. window destroyed) — safe to ignore
      });
  });

  autoUpdater.checkForUpdatesAndNotify();
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
  // Register the custom protocol handler that serves static files from
  // the Expo web export directory (dist/). This runs AFTER ready but the
  // scheme was registered as privileged above (before ready).
  const distDir = path.join(__dirname, '..');
  protocol.handle('graphite-app', (request) => {
    const url = new URL(request.url);
    let filePath = decodeURIComponent(url.pathname);
    // Root → index.html
    if (filePath === '/' || filePath === '') filePath = '/index.html';
    // Route paths like /(main) → /(main)/index.html
    if (!path.extname(filePath)) filePath += '/index.html';
    const fullPath = path.join(distDir, filePath);
    return net.fetch(pathToFileURL(fullPath).href);
  });

  initDatabase();
  registerIpcHandlers();
  createWindow();
  initAutoUpdater();

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
