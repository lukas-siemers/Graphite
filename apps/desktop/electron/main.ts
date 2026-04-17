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

// Scan the dist/assets tree for icon font files and build @font-face CSS.
// This is injected into index.html so icon fonts load before React mounts —
// expo-font's runtime loader can fail or race in the Electron context.
const ICON_FONT_MAP: Record<string, string> = {
  'MaterialCommunityIcons': 'material-community',
};

function buildIconFontCss(distDir: string): string {
  const fontsDir = path.join(
    distDir,
    'assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts',
  );
  const rules: string[] = [];
  try {
    const files = fs.readdirSync(fontsDir);
    for (const file of files) {
      if (!file.endsWith('.ttf')) continue;
      // Extract font name from "MaterialCommunityIcons.6e435534bd...ttf"
      const baseName = file.split('.')[0];
      const cssFamily = ICON_FONT_MAP[baseName];
      if (!cssFamily) continue;
      const relUrl = `/assets/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/${file}`;
      rules.push(
        `@font-face{font-family:"${cssFamily}";src:url("${relUrl}") format("truetype");font-display:block;}`
      );
    }
  } catch { /* fonts dir missing — skip */ }
  return rules.length > 0 ? `<style id="icon-fonts">${rules.join('')}</style>` : '';
}

function startStaticServer(distDir: string): Promise<number> {
  // Pre-compute icon font CSS once at startup.
  const iconFontCss = buildIconFontCss(distDir);

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
        let content: Buffer | string = fs.readFileSync(filePath);
        // Inject icon font CSS into HTML responses so fonts load before React.
        if (ext === '.html' && iconFontCss) {
          const html = content.toString('utf8');
          content = html.replace('</head>', `${iconFontCss}</head>`);
        }
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
//
// The main process only opens the database file and sets pragmas. All schema
// creation and migrations are driven by the renderer through the raw SQL IPC
// handlers below — the single source of truth for the schema lives in
// packages/db/src/schema.ts + migrations.ts.
// ---------------------------------------------------------------------------

let db: Database.Database;

function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'graphite.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
}

// Normalise Buffer → Uint8Array in any row returned over IPC. Electron's
// structured clone can handle Uint8Array but better-sqlite3 returns Buffer
// for BLOB columns. Walk every value and convert in-place.
function normalizeRow(row: Record<string, unknown> | null | undefined): Record<string, unknown> | null | undefined {
  if (!row) return row;
  for (const key of Object.keys(row)) {
    const val = row[key];
    if (val && Buffer.isBuffer(val)) {
      row[key] = new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
    }
  }
  return row;
}

function normalizeRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((r) => normalizeRow(r) as Record<string, unknown>);
}

// Convert Uint8Array params to Buffer for better-sqlite3 BLOB binding.
function normalizeParams(params: unknown[]): unknown[] {
  return params.map((p) => {
    if (p instanceof Uint8Array && !Buffer.isBuffer(p)) {
      return Buffer.from(p.buffer, p.byteOffset, p.byteLength);
    }
    return p;
  });
}

// ---------------------------------------------------------------------------
// IPC handlers — raw SQL interface
//
// The renderer's @graphite/db IPC adapter calls these to execute arbitrary SQL
// against the local better-sqlite3 database. This replaces the previous
// per-operation IPC handlers — the operation logic now lives entirely in the
// shared packages/db code, executed in the renderer and forwarded here as SQL.
// ---------------------------------------------------------------------------

function registerIpcHandlers() {
  // Execute one or more SQL statements (no params, no return value).
  // Used for PRAGMA, CREATE TABLE, multi-statement DDL.
  ipcMain.handle('sql:exec', (_e, sql: string) => {
    try {
      db.exec(sql);
      return { ok: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Execute a single statement with params. Returns lastInsertRowId + changes.
  ipcMain.handle('sql:run', (_e, sql: string, params?: unknown[]) => {
    try {
      const stmt = db.prepare(sql);
      const result = params && params.length > 0
        ? stmt.run(...normalizeParams(params))
        : stmt.run();
      return {
        ok: true,
        lastInsertRowId: Number(result.lastInsertRowid),
        changes: result.changes,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Fetch all matching rows.
  ipcMain.handle('sql:getAll', (_e, sql: string, params?: unknown[]) => {
    try {
      const stmt = db.prepare(sql);
      const rows = params && params.length > 0
        ? stmt.all(...normalizeParams(params)) as Array<Record<string, unknown>>
        : stmt.all() as Array<Record<string, unknown>>;
      return { ok: true, rows: normalizeRows(rows) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Fetch the first matching row (or null).
  ipcMain.handle('sql:getFirst', (_e, sql: string, params?: unknown[]) => {
    try {
      const stmt = db.prepare(sql);
      const row = params && params.length > 0
        ? stmt.get(...normalizeParams(params)) as Record<string, unknown> | undefined
        : stmt.get() as Record<string, unknown> | undefined;
      return { ok: true, row: normalizeRow(row ?? null) ?? null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
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
    // Remove the OS title bar. On Windows, titleBarOverlay keeps the native
    // minimize / maximize / close buttons overlaid in the top-right corner.
    // On macOS, titleBarStyle: 'hiddenInset' preserves the traffic lights.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const }
      : {
          frame: false,
          titleBarOverlay: {
            color: '#1E1E1E',
            symbolColor: '#8A8F98',
            height: 32,
          },
        }),
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
