import { create } from 'zustand';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  type Notebook,
  getNotebooks,
  createNotebook,
  deleteNotebook,
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
  deleteNotebook: (db: SQLiteDatabase, id: string) => Promise<void>;
}

export const useNotebookStore = create<NotebookState>((set) => ({
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
    await deleteNotebook(db, id);
    set((state) => ({
      notebooks: state.notebooks.filter((n) => n.id !== id),
      activeNotebookId: state.activeNotebookId === id ? null : state.activeNotebookId,
    }));
  },
}));
