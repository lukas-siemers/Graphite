/**
 * Electron preload script.
 * Exposes safe IPC bridges to the renderer via contextBridge.
 * All Node.js / sqlite operations are delegated to main.ts via ipcRenderer.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('graphite', {
  // Raw SQL bridge — used by @graphite/db's IPC database adapter.
  // The renderer's initDatabase() detects this object and creates a
  // SQLiteDatabase adapter that routes all queries through these methods
  // to the main process's better-sqlite3 instance.
  sql: {
    exec: (sql: string) =>
      ipcRenderer.invoke('sql:exec', sql),
    run: (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('sql:run', sql, params),
    getAll: (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('sql:getAll', sql, params),
    getFirst: (sql: string, params?: unknown[]) =>
      ipcRenderer.invoke('sql:getFirst', sql, params),
  },
  onDeepLink: (callback: (url: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string) => callback(url);
    ipcRenderer.on('deep-link', handler);
    return () => ipcRenderer.removeListener('deep-link', handler);
  },
});
