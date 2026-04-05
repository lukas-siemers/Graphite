import { create } from 'zustand';
import type { SQLiteDatabase } from 'expo-sqlite';
import {
  type Note,
  type CanvasDocument,
  getNotes,
  createNote,
  updateNote,
  deleteNote,
  updateNoteSortOrder,
  createEmptyCanvas,
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
  updateNoteCanvas: (
    db: SQLiteDatabase,
    id: string,
    canvasDoc: CanvasDocument,
    silent?: boolean,
  ) => Promise<void>;
  deleteNote: (db: SQLiteDatabase, id: string) => Promise<void>;
  reorderNotes: (db: SQLiteDatabase, orderedIds: string[]) => Promise<void>;
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
    // Pre-populate canvas_json so new notes go straight to CanvasRenderer
    // without waiting for the migration hook to run.
    const canvasDoc = createEmptyCanvas();
    const canvasJson = JSON.stringify(canvasDoc);
    await updateNote(db, note.id, { canvasJson, skipTimestamp: true });
    const noteWithCanvas = { ...note, canvasJson };
    set((state) => ({
      notes: [noteWithCanvas, ...state.notes],
      activeNoteId: note.id,
    }));
    return noteWithCanvas;
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

  updateNoteCanvas: async (
    db: SQLiteDatabase,
    id: string,
    canvasDoc: CanvasDocument,
    silent = false,
  ) => {
    const canvasJson = JSON.stringify(canvasDoc);
    // Write to SQLite — pass skipTimestamp when silent so migration writes
    // do not alter the note's updated_at in the DB.
    await updateNote(db, id, { canvasJson, skipTimestamp: silent });
    // Sync in-memory store; isDirty stays 0 (Phase 1 — no sync).
    // When silent, do not update updatedAt so sort order is preserved.
    set((state) => ({
      notes: state.notes.map((n) =>
        n.id === id
          ? { ...n, canvasJson, ...(silent ? {} : { updatedAt: Date.now() }) }
          : n,
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

  reorderNotes: async (db: SQLiteDatabase, orderedIds: string[]) => {
    await Promise.all(orderedIds.map((id, index) => updateNoteSortOrder(db, id, index)));
    set((s) => {
      const orderMap = new Map(orderedIds.map((id, i) => [id, i]));
      const updated = s.notes.map((n) => ({ ...n, sortOrder: orderMap.get(n.id) ?? n.sortOrder }));
      updated.sort((a, b) => a.sortOrder - b.sortOrder);
      return { notes: updated };
    });
  },
}));
