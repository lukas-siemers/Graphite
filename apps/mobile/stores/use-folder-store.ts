import { create } from 'zustand';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  type Folder,
  getFolders,
  createFolder,
  deleteFolder,
} from '@graphite/db';

interface FolderState {
  folders: Folder[];
  activeFolderId: string | null;
  setFolders: (folders: Folder[]) => void;
  setActiveFolder: (id: string | null) => void;
  addFolder: (folder: Folder) => void;
  updateFolder: (id: string, patch: Partial<Folder>) => void;
  removeFolder: (id: string) => void;
  loadFolders: (db: SQLiteDatabase, notebookId: string) => Promise<void>;
  createNewFolder: (
    db: SQLiteDatabase,
    notebookId: string,
    name: string,
    parentId?: string,
  ) => Promise<Folder>;
  deleteFolder: (db: SQLiteDatabase, id: string) => Promise<void>;
}

export const useFolderStore = create<FolderState>((set) => ({
  folders: [],
  activeFolderId: null,
  setFolders: (folders) => set({ folders }),
  setActiveFolder: (id) => set({ activeFolderId: id }),
  addFolder: (folder) =>
    set((state) => ({ folders: [...state.folders, folder] })),
  updateFolder: (id, patch) =>
    set((state) => ({
      folders: state.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    })),
  removeFolder: (id) =>
    set((state) => ({ folders: state.folders.filter((f) => f.id !== id) })),

  loadFolders: async (db: SQLiteDatabase, notebookId: string) => {
    const freshFolders = await getFolders(db, notebookId);
    // Merge: keep folders that belong to other notebooks so that multiple
    // expanded FolderTree instances don't wipe each other's data.
    set((state) => ({
      folders: [
        ...state.folders.filter((f) => f.notebookId !== notebookId),
        ...freshFolders,
      ],
    }));
  },

  createNewFolder: async (
    db: SQLiteDatabase,
    notebookId: string,
    name: string,
    parentId?: string,
  ) => {
    const folder = await createFolder(db, notebookId, name, parentId);
    set((state) => ({ folders: [...state.folders, folder] }));
    return folder;
  },

  deleteFolder: async (db: SQLiteDatabase, id: string) => {
    await deleteFolder(db, id);
    set((state) => ({
      folders: state.folders.filter((f) => f.id !== id),
      activeFolderId: state.activeFolderId === id ? null : state.activeFolderId,
    }));
  },
}));
