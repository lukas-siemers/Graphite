import { create } from 'zustand';
import type { Notebook } from '@graphite/db';

interface NotebookState {
  notebooks: Notebook[];
  activeNotebookId: string | null;
  setNotebooks: (notebooks: Notebook[]) => void;
  setActiveNotebook: (id: string | null) => void;
  addNotebook: (notebook: Notebook) => void;
  updateNotebook: (id: string, patch: Partial<Notebook>) => void;
  removeNotebook: (id: string) => void;
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
}));
