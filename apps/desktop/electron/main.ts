/**
 * Graphite — Electron main process
 *
 * Rules (from CLAUDE.md):
 * - All Node.js APIs (fs, better-sqlite3, shell) live exclusively in this file.
 * - The renderer is a pure web context — never import Node APIs there.
 * - Expose functionality to the renderer ONLY via contextBridge IPC.
 */

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import http from 'http';
import Database from 'better-sqlite3';
import { autoUpdater } from 'electron-updater';

// ---------------------------------------------------------------------------
// Local static server for serving the Expo web export in production.
//
// Expo Router reads window.location.pathname to resolve routes. Loading
// via file:// gives it the full filesystem path which matches no route.
// A local HTTP server gives Expo Router clean paths and correct MIME types
// for all assets (JS, CSS, fonts, images).
// ---------------------------------------------------------------------------

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ttf':  'font/ttf',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.otf':  'font/otf',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.map':  'application/json',
};

let staticServerPort = 0;

function startStaticServer(distDir: string): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
      let filePath = path.join(distDir, urlPath);

      // Directory → index.html
      try {
        if (fs.statSync(filePath).isDirectory()) {
          filePath = path.join(filePath, 'index.html');
        }
      } catch { /* not a directory */ }

      // Fallback: if file doesn't exist, serve root index.html (SPA fallback)
      if (!fs.existsSync(filePath)) {
        filePath = path.join(distDir, 'index.html');
      }

      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';

      try {
        const content = fs.readFileSync(filePath);
        res.writeHead(200, { 'Content-Type': mime });
        res.end(content);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    // Listen on a random available port on loopback only (not exposed to network)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      staticServerPort = port;
      resolve(port);
    });
  });
}

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
    // Load from the local static server so Expo Router sees clean paths
    // and all assets (JS, fonts, images) have correct MIME types.
    mainWindow.loadURL(`http://127.0.0.1:${staticServerPort}/`);
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

app.whenReady().then(async () => {
  // Start the local static server for production builds. __dirname is
  // dist/electron/ — the web export lives one level up at dist/.
  if (process.env.NODE_ENV !== 'development') {
    const distDir = path.join(__dirname, '..');
    await startStaticServer(distDir);
  }

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
