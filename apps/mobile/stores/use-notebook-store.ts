import { create } from 'zustand';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  type Notebook,
  getNotebooks,
  createNotebook,
  deleteNotebook,
  updateNotebookSortOrder,
} from '@graphite/db';

interface NotebookState {
  notebooks: Notebook[];
  activeNotebookId: string | null;
  setNotebooks: (notebooks: Notebook[]) => void;
  setActiveNotebook: (id: string | null) => void;
  addNotebook: (notebook: Notebook) => void;
  updateNotebook: (id: string, patch: Partial<Notebook>) => void;
  removeNotebook: (id: string) => void;
  loadNotebooks: (db: SQLiteDatabase) => Promise<void>;
  createNewNotebook: (db: SQLiteDatabase, name: string) => Promise<Notebook>;
  deleteNotebook: (
    db: SQLiteDatabase,
    id: string,
  ) => Promise<{ deletedFolderIds: string[]; deletedNoteIds: string[] }>;
  moveNotebookUp: (db: SQLiteDatabase, id: string) => Promise<void>;
  moveNotebookDown: (db: SQLiteDatabase, id: string) => Promise<void>;
  reorderNotebooks: (db: SQLiteDatabase, orderedIds: string[]) => Promise<void>;
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  notebooks: [],
  activeNotebookId: null,
  setNotebooks: (notebooks) => set({ notebooks }),
  setActiveNotebook: (id) => set({ activeNotebookId: id }),
  addNotebook: (notebook) =>
    set((state) => ({ notebooks: [...state.notebooks, notebook] })),
  updateNotebook: (id, patch) =>
    set((state) => ({
      notebooks: state.notebooks.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    })),
  removeNotebook: (id) =>
    set((state) => ({ notebooks: state.notebooks.filter((n) => n.id !== id) })),

  loadNotebooks: async (db: SQLiteDatabase) => {
    const notebooks = await getNotebooks(db);
    set({ notebooks });
  },

  createNewNotebook: async (db: SQLiteDatabase, name: string) => {
    const notebook = await createNotebook(db, name);
    set((state) => ({ notebooks: [...state.notebooks, notebook] }));
    return notebook;
  },

  deleteNotebook: async (db: SQLiteDatabase, id: string) => {
    const result = await deleteNotebook(db, id);
    set((state) => ({
      notebooks: state.notebooks.filter((n) => n.id !== id),
      activeNotebookId: state.activeNotebookId === id ? null : state.activeNotebookId,
    }));
    return result;
  },

  moveNotebookUp: async (db: SQLiteDatabase, id: string) => {
    const { notebooks } = get();
    const idx = notebooks.findIndex((n) => n.id === id);
    if (idx <= 0) return;
    const prev = notebooks[idx - 1];
    const curr = notebooks[idx];
    // Swap sort_order values
    await updateNotebookSortOrder(db, curr.id, prev.sortOrder);
    await updateNotebookSortOrder(db, prev.id, curr.sortOrder);
    const updated = [...notebooks];
    updated[idx - 1] = { ...prev, sortOrder: curr.sortOrder };
    updated[idx] = { ...curr, sortOrder: prev.sortOrder };
    updated.sort((a, b) => a.sortOrder - b.sortOrder);
    set({ notebooks: updated });
  },

  moveNotebookDown: async (db: SQLiteDatabase, id: string) => {
    const { notebooks } = get();
    const idx = notebooks.findIndex((n) => n.id === id);
    if (idx < 0 || idx >= notebooks.length - 1) return;
    const next = notebooks[idx + 1];
    const curr = notebooks[idx];
    // Swap sort_order values
    await updateNotebookSortOrder(db, curr.id, next.sortOrder);
    await updateNotebookSortOrder(db, next.id, curr.sortOrder);
    const updated = [...notebooks];
    updated[idx + 1] = { ...next, sortOrder: curr.sortOrder };
    updated[idx] = { ...curr, sortOrder: next.sortOrder };
    updated.sort((a, b) => a.sortOrder - b.sortOrder);
    set({ notebooks: updated });
  },

  reorderNotebooks: async (db: SQLiteDatabase, orderedIds: string[]) => {
    await Promise.all(orderedIds.map((id, index) => updateNotebookSortOrder(db, id, index)));
    set((s) => {
      const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
      const updated = s.notebooks.map((n) => ({ ...n, sortOrder: orderMap.get(n.id) ?? n.sortOrder }));
      updated.sort((a, b) => a.sortOrder - b.sortOrder);
      return { notebooks: updated };
    });
  },
}));
