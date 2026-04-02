/**
 * Electron preload script.
 * Exposes safe IPC bridges to the renderer via contextBridge.
 * All Node.js / sqlite operations are delegated to main.ts via ipcRenderer.
 */
import { contextBridge, ipcRenderer } from 'electron';

// Phase 3 placeholder — IPC contract defined here.
contextBridge.exposeInMainWorld('graphite', {
  // db: { getNotes, createNote, updateNote, deleteNote }
  // sync: { push, pull }
});
