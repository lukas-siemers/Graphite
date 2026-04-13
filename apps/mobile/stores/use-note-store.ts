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
  moveNote as dbMoveNote,
  extractTags,
  syncNoteTags,
  searchNotesEnhanced,
} from '@graphite/db';
import {
  serializeToGraphite,
  extractSearchableText,
  type SpatialCanvasDocument,
} from '@graphite/canvas';
// NOTE: imported for cross-store read only. We access via getState() inside
// actions (never at module scope) to avoid circular-init issues.
import { useFolderStore } from './use-folder-store';

// Module-scoped debounce timer for search (ref-based, no library).
let searchTimer: ReturnType<typeof setTimeout> | null = null;

interface NoteState {
  notes: Note[];
  activeNoteId: string | null;
  searchResults: Note[];
  isSearching: boolean;
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
  searchNotes: (
    db: SQLiteDatabase,
    notebookId: string,
    query: string,
  ) => void;
  clearSearch: () => void;
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
  updateNoteSpatialCanvas: (
    db: SQLiteDatabase,
    id: string,
    spatialDoc: SpatialCanvasDocument,
    silent?: boolean,
  ) => Promise<void>;
  deleteNote: (db: SQLiteDatabase, id: string) => Promise<void>;
  moveNote: (
    db: SQLiteDatabase,
    noteId: string,
    targetFolderId: string | null,
  ) => Promise<void>;
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
  searchResults: [],
  isSearching: false,
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

  searchNotes: (
    db: SQLiteDatabase,
    notebookId: string,
    query: string,
  ) => {
    if (searchTimer) clearTimeout(searchTimer);
    if (!query.trim()) {
      set({ searchResults: [], isSearching: false });
      return;
    }
    set({ isSearching: true });
    searchTimer = setTimeout(async () => {
      const results = await searchNotesEnhanced(db, notebookId, query);
      set({ searchResults: results, isSearching: false });
    }, 150);
  },

  clearSearch: () => {
    if (searchTimer) clearTimeout(searchTimer);
    set({ searchResults: [], isSearching: false });
  },

  createNewNote: async (
    db: SQLiteDatabase,
    notebookId: string,
    folderId?: string,
  ) => {
    // createNote() returns a row with canvas_version=2 and graphite_blob=null.
    // The v2 migration hook (use-spatial-canvas-migration) treats that pair as
    // an empty canvas and hands back createEmptySpatialCanvas() without any
    // DB write. The first user edit will then fire updateNoteSpatialCanvas
    // which serializes the blob. No canvasJson pre-population here — that path
    // was dead on v2 and risked confusing the v1 branch of the migration hook
    // for any edge-case note that flipped back to canvasVersion !== 2.
    const note = await createNote(db, notebookId, folderId);

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
        notes: [note, ...state.notes],
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

  updateNoteSpatialCanvas: async (
    db: SQLiteDatabase,
    id: string,
    spatialDoc: SpatialCanvasDocument,
    silent = false,
  ) => {
    const blob = await serializeToGraphite(spatialDoc);
    const ftsBody = extractSearchableText(spatialDoc);
    // v2 notes no longer write user content into the legacy `body` column —
    // blob + ftsBody are the authoritative pair. Keep `body` empty so search
    // and list-preview fallbacks don't show stale pre-migration text.
    await updateNote(db, id, {
      graphiteBlob: blob,
      ftsBody,
      canvasVersion: 2,
      body: '',
      skipTimestamp: silent,
    });
    set((state) => ({
      notes: state.notes.map((n) =>
        n.id === id
          ? {
              ...n,
              graphiteBlob: blob,
              ftsBody,
              canvasVersion: 2,
              body: '',
              ...(silent ? {} : { updatedAt: Date.now() }),
            }
          : n,
      ),
    }));
    if (ftsBody) {
      const tags = extractTags(ftsBody);
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
