import { create } from 'zustand';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  type Folder,
  getFolders,
  createFolder,
  deleteFolder,
  renameFolder as dbRenameFolder,
  updateFolderSortOrder,
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
  deleteFolder: (
    db: SQLiteDatabase,
    id: string,
  ) => Promise<{ deletedFolderIds: string[]; deletedNoteIds: string[] }>;
  renameFolder: (db: SQLiteDatabase, id: string, name: string) => Promise<void>;
  moveFolderUp: (db: SQLiteDatabase, id: string, notebookId: string) => Promise<void>;
  moveFolderDown: (db: SQLiteDatabase, id: string, notebookId: string) => Promise<void>;
  reorderFolders: (db: SQLiteDatabase, notebookId: string, orderedIds: string[]) => Promise<void>;
}

export const useFolderStore = create<FolderState>((set, get) => ({
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

  renameFolder: async (db: SQLiteDatabase, id: string, name: string) => {
    await dbRenameFolder(db, id, name);
    const now = Date.now();
    set((state) => ({
      folders: state.folders.map((f) =>
        f.id === id ? { ...f, name, updatedAt: now } : f,
      ),
    }));
  },

  deleteFolder: async (db: SQLiteDatabase, id: string) => {
    const { deletedFolderIds, deletedNoteIds } = await deleteFolder(db, id);
    const folderIdSet = new Set(deletedFolderIds);
    set((state) => ({
      folders: state.folders.filter((f) => !folderIdSet.has(f.id)),
      activeFolderId:
        state.activeFolderId && folderIdSet.has(state.activeFolderId)
          ? null
          : state.activeFolderId,
    }));
    return { deletedFolderIds, deletedNoteIds };
  },

  moveFolderUp: async (db: SQLiteDatabase, id: string, notebookId: string) => {
    const { folders } = get();
    // Work only within the same notebook, sorted by sort_order
    const notebookFolders = folders
      .filter((f) => f.notebookId === notebookId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = notebookFolders.findIndex((f) => f.id === id);
    if (idx <= 0) return;
    const prev = notebookFolders[idx - 1];
    const curr = notebookFolders[idx];
    await updateFolderSortOrder(db, curr.id, prev.sortOrder);
    await updateFolderSortOrder(db, prev.id, curr.sortOrder);
    set((state) => ({
      folders: state.folders.map((f) => {
        if (f.id === curr.id) return { ...f, sortOrder: prev.sortOrder };
        if (f.id === prev.id) return { ...f, sortOrder: curr.sortOrder };
        return f;
      }),
    }));
  },

  moveFolderDown: async (db: SQLiteDatabase, id: string, notebookId: string) => {
    const { folders } = get();
    const notebookFolders = folders
      .filter((f) => f.notebookId === notebookId)
      .sort((a, b) => a.sortOrder - b.sortOrder);
    const idx = notebookFolders.findIndex((f) => f.id === id);
    if (idx < 0 || idx >= notebookFolders.length - 1) return;
    const next = notebookFolders[idx + 1];
    const curr = notebookFolders[idx];
    await updateFolderSortOrder(db, curr.id, next.sortOrder);
    await updateFolderSortOrder(db, next.id, curr.sortOrder);
    set((state) => ({
      folders: state.folders.map((f) => {
        if (f.id === curr.id) return { ...f, sortOrder: next.sortOrder };
        if (f.id === next.id) return { ...f, sortOrder: curr.sortOrder };
        return f;
      }),
    }));
  },

  reorderFolders: async (db: SQLiteDatabase, notebookId: string, orderedIds: string[]) => {
    await Promise.all(orderedIds.map((id, index) => updateFolderSortOrder(db, id, index)));
    set((s) => {
      const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
      const updated = s.folders.map((f) =>
        f.notebookId === notebookId
          ? { ...f, sortOrder: orderMap.get(f.id) ?? f.sortOrder }
          : f,
      );
      return { folders: updated };
    });
  },
}));
