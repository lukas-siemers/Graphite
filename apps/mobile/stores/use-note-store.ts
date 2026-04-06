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
  moveNoteToNotebook as dbMoveNoteToNotebook,
  createEmptyCanvas,
  moveNote as dbMoveNote,
  extractTags,
  syncNoteTags,
} from '@graphite/db';
// NOTE: imported for cross-store read only. We access via getState() inside
// actions (never at module scope) to avoid circular-init issues.
import { useFolderStore } from './use-folder-store';

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
  moveNote: (
    db: SQLiteDatabase,
    noteId: string,
    targetFolderId: string | null,
  ) => Promise<void>;
  deleteIfEmpty: (db: SQLiteDatabase, id: string) => Promise<boolean>;
  reorderNotes: (db: SQLiteDatabase, orderedIds: string[]) => Promise<void>;
  moveNoteToNotebook: (
    db: SQLiteDatabase,
    noteId: string,
    targetNotebookId: string,
    targetFolderId?: string | null,
  ) => Promise<void>;
}

export const useNoteStore = create<NoteState>((set, get) => ({
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

    // Folder-context awareness: if the new note targets a different folder
    // than the currently active one in the sidebar, switch the active folder
    // and reload that folder's notes from the DB. The reloaded list will
    // already contain the freshly-inserted note (createNote committed above),
    // so we only need to set activeNoteId — no optimistic prepend.
    const folderStore = useFolderStore.getState();
    const currentFolderId = folderStore.activeFolderId;
    const targetFolderId = folderId ?? null;
    const sameFolder = currentFolderId === targetFolderId;

    if (sameFolder) {
      // Fast path: optimistic prepend for the currently viewed folder.
      set((state) => ({
        notes: [noteWithCanvas, ...state.notes],
        activeNoteId: note.id,
      }));
    } else {
      // Switch sidebar selection to the target folder, reload its notes
      // (which already includes the new note from the DB), and mark the
      // new note active.
      folderStore.setActiveFolder(targetFolderId);
      // getNotes treats null/undefined as "no folder filter = notebook-wide";
      // callers elsewhere pass null for the top-level bucket, so preserve
      // that semantic here.
      const reloaded = await getNotes(db, notebookId, targetFolderId);
      set({ notes: reloaded, activeNoteId: note.id });
    }
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
    // Sync tags extracted from the body text
    if (patch.body !== undefined) {
      const tags = extractTags(patch.body);
      await syncNoteTags(db, id, tags);
      const { useTagStore } = await import('./use-tag-store');
      await useTagStore.getState().loadTags(db);
    }
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
    // Sync tags from canvas body text
    const bodyText = canvasDoc.textContent?.body ?? '';
    if (bodyText) {
      const tags = extractTags(bodyText);
      await syncNoteTags(db, id, tags);
      const { useTagStore } = await import('./use-tag-store');
      await useTagStore.getState().loadTags(db);
    }
  },

  deleteNote: async (db: SQLiteDatabase, id: string) => {
    // syncNoteTags with empty array removes all links and GCs orphaned tags
    await syncNoteTags(db, id, []);
    await deleteNote(db, id);
    set((state) => ({
      notes: state.notes.filter((n) => n.id !== id),
      activeNoteId: state.activeNoteId === id ? null : state.activeNoteId,
    }));
    const { useTagStore } = await import('./use-tag-store');
    await useTagStore.getState().loadTags(db);
  },

  /**
   * Move a note to a different folder (or to null / no-folder) within the
   * same notebook. DB write happens first, then the in-memory list is
   * reconciled against the currently-viewed folder context.
   *
   * Three cases:
   *   - movedOut: note was in the active folder view, now isn't → drop it
   *   - movedIn: note wasn't in the active folder view, now is → prepend it
   *   - neither: in-place patch (same folder view or neither matches)
   *
   * A no-op move (same folder) early-exits without touching state to avoid
   * an unnecessary re-render of the list.
   */
  moveNote: async (
    db: SQLiteDatabase,
    noteId: string,
    targetFolderId: string | null,
  ) => {
    const current = get().notes.find((n) => n.id === noteId);
    // Same-folder move → no-op (skip DB write and state update entirely).
    if (current && current.folderId === targetFolderId) return;

    await dbMoveNote(db, noteId, targetFolderId);
    const now = Date.now();
    set((state) => {
      const activeFolderId = useFolderStore.getState().activeFolderId;
      const note = state.notes.find((n) => n.id === noteId);
      if (!note) return {};
      const movedOut =
        note.folderId === activeFolderId && targetFolderId !== activeFolderId;
      const movedIn =
        note.folderId !== activeFolderId && targetFolderId === activeFolderId;
      if (movedOut) {
        return { notes: state.notes.filter((n) => n.id !== noteId) };
      }
      if (movedIn) {
        return {
          notes: [
            { ...note, folderId: targetFolderId, updatedAt: now },
            ...state.notes,
          ],
        };
      }
      return {
        notes: state.notes.map((n) =>
          n.id === noteId
            ? { ...n, folderId: targetFolderId, updatedAt: now }
            : n,
        ),
      };
    });
  },

  /**
   * Auto-delete an abandoned empty note. Called from the editor on
   * navigate-away (active note transition or unmount). Returns true if the
   * note was deleted, false otherwise.
   *
   * A note is considered empty when:
   *   - title is '' or 'Untitled' (the default), AND
   *   - canvas text body (preferred) or legacy body is whitespace-only, AND
   *   - the canvas ink layer has zero strokes (drawing-only notes are kept).
   *
   * The deletion goes through the DB deleteNote op so FTS5 cleanup runs.
   */
  deleteIfEmpty: async (db: SQLiteDatabase, id: string) => {
    const note = get().notes.find((n) => n.id === id);
    if (!note) return false;
    const titleEmpty = note.title === '' || note.title === 'Untitled';
    // Prefer canvas text body if migrated, else the legacy body field.
    let bodyText = note.body ?? '';
    let hasInk = false;
    if (note.canvasJson) {
      try {
        const doc = JSON.parse(note.canvasJson) as CanvasDocument;
        bodyText = doc.textContent?.body ?? '';
        hasInk = (doc.inkLayer?.strokes?.length ?? 0) > 0;
      } catch {
        // Fall through with legacy body; assume no ink on parse failure.
      }
    }
    const bodyEmpty = bodyText.trim() === '';
    if (!(titleEmpty && bodyEmpty) || hasInk) return false;
    await deleteNote(db, id);
    set((s) => ({
      notes: s.notes.filter((n) => n.id !== id),
      activeNoteId: s.activeNoteId === id ? null : s.activeNoteId,
    }));
    return true;
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


  moveNoteToNotebook: async (
    db: SQLiteDatabase,
    noteId: string,
    targetNotebookId: string,
    targetFolderId: string | null = null,
  ) => {
    await dbMoveNoteToNotebook(db, noteId, targetNotebookId, targetFolderId);
    set((s) => ({
      notes: s.notes.filter((n) => n.id !== noteId),
      activeNoteId: s.activeNoteId === noteId ? null : s.activeNoteId,
    }));
  },
}));
