import { create } from 'zustand';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  type Note,
  getNotes,
  createNote,
  updateNote,
  deleteNote,
} from '@graphite/db';

interface NoteState {
  notes: Note[];
  activeNoteId: string | null;
  setNotes: (notes: Note[]) => void;
  setActiveNote: (id: string | null) => void;
  addNote: (note: Note) => void;
  updateNote: (id: string, patch: Partial<Note>) => void;
  removeNote: (id: string) => void;
  loadNotes: (
    db: SQLiteDatabase,
    notebookId: string,
    folderId?: string | null,
  ) => Promise<void>;
  createNewNote: (
    db: SQLiteDatabase,
    notebookId: string,
    folderId?: string,
  ) => Promise<Note>;
  saveNote: (
    db: SQLiteDatabase,
    id: string,
    patch: { title?: string; body?: string },
  ) => Promise<void>;
  deleteNote: (db: SQLiteDatabase, id: string) => Promise<void>;
}

export const useNoteStore = create<NoteState>((set) => ({
  notes: [],
  activeNoteId: null,
  setNotes: (notes) => set({ notes }),
  setActiveNote: (id) => set({ activeNoteId: id }),
  addNote: (note) =>
    set((state) => ({ notes: [...state.notes, note] })),
  updateNote: (id, patch) =>
    set((state) => ({
      notes: state.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    })),
  removeNote: (id) =>
    set((state) => ({ notes: state.notes.filter((n) => n.id !== id) })),

  loadNotes: async (
    db: SQLiteDatabase,
    notebookId: string,
    folderId?: string | null,
  ) => {
    const notes = await getNotes(db, notebookId, folderId);
    set({ notes });
  },

  createNewNote: async (
    db: SQLiteDatabase,
    notebookId: string,
    folderId?: string,
  ) => {
    const note = await createNote(db, notebookId, folderId);
    set((state) => ({
      notes: [note, ...state.notes],
      activeNoteId: note.id,
    }));
    return note;
  },

  saveNote: async (
    db: SQLiteDatabase,
    id: string,
    patch: { title?: string; body?: string },
  ) => {
    await updateNote(db, id, patch);
    const now = Date.now();
    set((state) => ({
      notes: state.notes.map((n) =>
        n.id === id ? { ...n, ...patch, updatedAt: now } : n,
      ),
    }));
  },

  deleteNote: async (db: SQLiteDatabase, id: string) => {
    await deleteNote(db, id);
    set((state) => ({
      notes: state.notes.filter((n) => n.id !== id),
      activeNoteId: state.activeNoteId === id ? null : state.activeNoteId,
    }));
  },
}));
