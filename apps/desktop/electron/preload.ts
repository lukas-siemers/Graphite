/**
 * Electron preload script.
 * Exposes safe IPC bridges to the renderer via contextBridge.
 * All Node.js / sqlite operations are delegated to main.ts via ipcRenderer.
 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('graphite', {
  db: {
    getNotebooks: () =>
      ipcRenderer.invoke('db:getNotebooks'),
    createNotebook: (notebook: { id: string; name: string; created_at: number; updated_at: number }) =>
      ipcRenderer.invoke('db:createNotebook', notebook),
    getFolders: (notebookId: string) =>
      ipcRenderer.invoke('db:getFolders', notebookId),
    createFolder: (folder: { id: string; notebook_id: string; parent_id?: string; name: string; created_at: number; updated_at: number }) =>
      ipcRenderer.invoke('db:createFolder', folder),
    getNotes: (notebookId: string) =>
      ipcRenderer.invoke('db:getNotes', notebookId),
    getNote: (id: string) =>
      ipcRenderer.invoke('db:getNote', id),
    createNote: (note: { id: string; notebook_id: string; folder_id?: string; title: string; body: string; created_at: number; updated_at: number }) =>
      ipcRenderer.invoke('db:createNote', note),
    updateNote: (id: string, fields: { title?: string; body?: string; drawing_asset_id?: string; canvas_json?: string | null; updated_at: number }) =>
      ipcRenderer.invoke('db:updateNote', id, fields),
    deleteNote: (id: string) =>
      ipcRenderer.invoke('db:deleteNote', id),
    deleteFolder: (id: string) =>
      ipcRenderer.invoke('db:deleteFolder', id),
    deleteNotebook: (id: string) =>
      ipcRenderer.invoke('db:deleteNotebook', id),
    searchNotes: (query: string) =>
      ipcRenderer.invoke('db:searchNotes', query),
  },
  onDeepLink: (callback: (url: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, url: string) => callback(url);
    ipcRenderer.on('deep-link', handler);
    // Return cleanup so callers can unsubscribe (prevents listener leaks on remount)
    return () => ipcRenderer.removeListener('deep-link', handler);
  },
});
