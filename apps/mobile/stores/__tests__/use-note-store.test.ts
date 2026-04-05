import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Note } from '../../../../packages/db/src/types';
import type { CanvasDocument } from '../../../../packages/db/src/canvas-types';
import { useNoteStore } from '../use-note-store';

// Mock the @graphite/db module so updateNote never hits SQLite in unit tests.
vi.mock('@graphite/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@graphite/db')>();
  return {
    ...actual,
    updateNote: vi.fn().mockResolvedValue(undefined),
    getNotes: vi.fn().mockResolvedValue([]),
    createNote: vi.fn(),
    deleteNote: vi.fn(),
    updateNoteSortOrder: vi.fn().mockResolvedValue(undefined),
  };
});

// Fixed test fixture
const note1: Note = {
  id: 'n-1',
  folderId: null,
  notebookId: 'nb-1',
  title: 'Hello',
  body: '',
  drawingAssetId: null,
  canvasJson: null,
  isDirty: 0,
  sortOrder: 0,
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  syncedAt: null,
};

const note2: Note = {
  id: 'n-2',
  folderId: 'f-1',
  notebookId: 'nb-1',
  title: 'World',
  body: '# World',
  drawingAssetId: null,
  canvasJson: null,
  isDirty: 0,
  sortOrder: 1,
  createdAt: 1700000000001,
  updatedAt: 1700000000001,
  syncedAt: null,
};

const note3: Note = {
  id: 'n-3',
  folderId: null,
  notebookId: 'nb-1',
  title: 'Third',
  body: '',
  drawingAssetId: null,
  canvasJson: null,
  isDirty: 0,
  sortOrder: 2,
  createdAt: 1700000000002,
  updatedAt: 1700000000002,
  syncedAt: null,
};

describe('useNoteStore', () => {
  beforeEach(() => {
    useNoteStore.setState({ notes: [], activeNoteId: null });
  });

  it('initial state: notes is empty array', () => {
    const { notes } = useNoteStore.getState();
    expect(notes).toEqual([]);
  });

  it('initial state: activeNoteId is null', () => {
    const { activeNoteId } = useNoteStore.getState();
    expect(activeNoteId).toBeNull();
  });

  it('setNotes: replaces notes array', () => {
    useNoteStore.getState().setNotes([note1, note2]);
    const { notes } = useNoteStore.getState();
    expect(notes).toEqual([note1, note2]);
  });

  it('setActiveNote: updates activeNoteId', () => {
    useNoteStore.getState().setActiveNote('n-1');
    expect(useNoteStore.getState().activeNoteId).toBe('n-1');
  });

  it('addNote: appends to notes array', () => {
    useNoteStore.getState().addNote(note1);
    useNoteStore.getState().addNote(note2);
    const { notes } = useNoteStore.getState();
    expect(notes).toHaveLength(2);
    expect(notes[0]).toEqual(note1);
    expect(notes[1]).toEqual(note2);
  });

  it('updateNote: patches matching note', () => {
    useNoteStore.getState().setNotes([note1, note2]);
    useNoteStore.getState().updateNote('n-1', { title: 'Updated Title', body: 'New body', updatedAt: 1700000001000 });
    const { notes } = useNoteStore.getState();
    const updated = notes.find((n) => n.id === 'n-1');
    expect(updated?.title).toBe('Updated Title');
    expect(updated?.body).toBe('New body');
    expect(updated?.updatedAt).toBe(1700000001000);
    // Unrelated note must be unchanged
    const other = notes.find((n) => n.id === 'n-2');
    expect(other).toEqual(note2);
  });

  it('removeNote: removes matching note', () => {
    useNoteStore.getState().setNotes([note1, note2]);
    useNoteStore.getState().removeNote('n-1');
    const { notes } = useNoteStore.getState();
    expect(notes.find((n) => n.id === 'n-1')).toBeUndefined();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toEqual(note2);
  });
});

// ---------------------------------------------------------------------------
// updateNoteCanvas regression tests
// ---------------------------------------------------------------------------

const emptyCanvas: CanvasDocument = {
  version: 1,
  textContent: { body: 'test body' },
  inkLayer: { strokes: [] },
};

// Minimal fake DB — updateNote is already mocked at module level above
const fakeDb = {} as any;

describe('updateNoteCanvas', () => {
  beforeEach(() => {
    useNoteStore.setState({ notes: [note1], activeNoteId: null });
  });

  it('silent=false: updatedAt changes after call', async () => {
    const before = useNoteStore.getState().notes.find((n) => n.id === 'n-1')!.updatedAt;
    await useNoteStore.getState().updateNoteCanvas(fakeDb, 'n-1', emptyCanvas, false);
    const after = useNoteStore.getState().notes.find((n) => n.id === 'n-1')!.updatedAt;
    expect(after).toBeGreaterThan(before);
  });

  it('silent=true: updatedAt does NOT change after call', async () => {
    const before = useNoteStore.getState().notes.find((n) => n.id === 'n-1')!.updatedAt;
    await useNoteStore.getState().updateNoteCanvas(fakeDb, 'n-1', emptyCanvas, true);
    const after = useNoteStore.getState().notes.find((n) => n.id === 'n-1')!.updatedAt;
    expect(after).toBe(before);
  });

  it('updateNoteCanvas never sets isDirty to 1', async () => {
    await useNoteStore.getState().updateNoteCanvas(fakeDb, 'n-1', emptyCanvas, false);
    const note = useNoteStore.getState().notes.find((n) => n.id === 'n-1')!;
    expect(note.isDirty).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// reorderNotes — bulk drag-and-drop reorder action
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// deleteNote — swipe / long-press delete action
// ---------------------------------------------------------------------------

describe('deleteNote', () => {
  beforeEach(() => {
    useNoteStore.setState({ notes: [note1, note2, note3], activeNoteId: null });
  });

  it('removes the matching note from the notes array', async () => {
    await useNoteStore.getState().deleteNote(fakeDb, 'n-2');
    const { notes } = useNoteStore.getState();
    expect(notes.find((n) => n.id === 'n-2')).toBeUndefined();
    expect(notes).toHaveLength(2);
  });

  it('clears activeNoteId when the deleted note was active', async () => {
    useNoteStore.setState({ activeNoteId: 'n-2' });
    await useNoteStore.getState().deleteNote(fakeDb, 'n-2');
    expect(useNoteStore.getState().activeNoteId).toBeNull();
  });

  it('preserves activeNoteId when a different note is deleted', async () => {
    useNoteStore.setState({ activeNoteId: 'n-1' });
    await useNoteStore.getState().deleteNote(fakeDb, 'n-2');
    expect(useNoteStore.getState().activeNoteId).toBe('n-1');
  });

  it('calls the DB deleteNote operation', async () => {
    const db = await import('@graphite/db');
    const mockDelete = db.deleteNote as unknown as ReturnType<typeof vi.fn>;
    mockDelete.mockClear();
    await useNoteStore.getState().deleteNote(fakeDb, 'n-1');
    expect(mockDelete).toHaveBeenCalledWith(fakeDb, 'n-1');
  });
});

describe('reorderNotes', () => {
  beforeEach(() => {
    useNoteStore.setState({ notes: [note1, note2, note3], activeNoteId: null });
  });

  it('assigns sequential sortOrder values matching the provided order', async () => {
    // Provide reversed order: n-3, n-2, n-1
    await useNoteStore.getState().reorderNotes(fakeDb, ['n-3', 'n-2', 'n-1']);
    const { notes } = useNoteStore.getState();
    expect(notes.find((n) => n.id === 'n-3')?.sortOrder).toBe(0);
    expect(notes.find((n) => n.id === 'n-2')?.sortOrder).toBe(1);
    expect(notes.find((n) => n.id === 'n-1')?.sortOrder).toBe(2);
  });

  it('re-sorts the in-memory notes array by the new sortOrder', async () => {
    await useNoteStore.getState().reorderNotes(fakeDb, ['n-3', 'n-2', 'n-1']);
    const { notes } = useNoteStore.getState();
    expect(notes[0].id).toBe('n-3');
    expect(notes[1].id).toBe('n-2');
    expect(notes[2].id).toBe('n-1');
  });

  it('does not alter notes that are not present in orderedIds', async () => {
    // Only reorder n-1 and n-2 — n-3 should keep its existing sortOrder (2).
    await useNoteStore.getState().reorderNotes(fakeDb, ['n-2', 'n-1']);
    const { notes } = useNoteStore.getState();
    expect(notes.find((n) => n.id === 'n-3')?.sortOrder).toBe(2);
  });

  it('produces correct sortOrder when a single note is provided', async () => {
    await useNoteStore.getState().reorderNotes(fakeDb, ['n-2']);
    const { notes } = useNoteStore.getState();
    expect(notes.find((n) => n.id === 'n-2')?.sortOrder).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// createNewNote — reproduction for "odd behavior when creating a new note"
//
// Root cause under test:
//   createNewNote unconditionally prepends the newly created note to the
//   in-memory `notes` array, regardless of whether that note belongs to the
//   currently viewed folder. In Sidebar FolderTree, each folder row has its
//   own "+ New Note" button that calls createNewNote(db, notebookId, folderId)
//   for THAT folder, not the currently active one. If the user is viewing
//   folder A and clicks the "+ New Note" button on folder B, the note is
//   written under folder B in SQLite but also injected at position 0 of
//   folder A's in-memory list — and activeNoteId is set to it, so the Editor
//   opens a note whose folder the sidebar does not have selected. From the
//   user's perspective the new note appears "under the wrong folder".
//
// The fix belongs in createNewNote (or its callers): it must only insert the
// created note into `notes` when its folderId matches the currently viewed
// folder filter, or it should switch the active folder before prepending.
// ---------------------------------------------------------------------------

describe('createNewNote', () => {
  beforeEach(async () => {
    useNoteStore.setState({ notes: [], activeNoteId: null });
    const db = await import('@graphite/db');
    const mockCreate = db.createNote as unknown as ReturnType<typeof vi.fn>;
    mockCreate.mockReset();
  });

  it('does not pollute the active folder list when creating a note for a different folder', async () => {
    // Arrange: user is currently viewing folder A; its notes are loaded.
    const folderANote: Note = {
      ...note1,
      id: 'note-in-A',
      folderId: 'folder-A',
    };
    useNoteStore.setState({ notes: [folderANote], activeNoteId: 'note-in-A' });

    // The user clicks the "+ New Note" button on folder B in the sidebar.
    // createNote (DB op) returns a note whose folderId is folder-B.
    const db = await import('@graphite/db');
    const mockCreate = db.createNote as unknown as ReturnType<typeof vi.fn>;
    mockCreate.mockResolvedValue({
      id: 'note-in-B',
      folderId: 'folder-B',
      notebookId: 'nb-1',
      title: 'Untitled',
      body: '',
      drawingAssetId: null,
      canvasJson: null,
      isDirty: 0,
      sortOrder: 0,
      createdAt: 1700000100000,
      updatedAt: 1700000100000,
      syncedAt: null,
    } as Note);

    // Act: create the new note for folder B while folder A is still active.
    await useNoteStore.getState().createNewNote(fakeDb, 'nb-1', 'folder-B');

    // Assert: the folder-A note list must not contain a note whose folderId
    // is something other than folder-A. The bug under test causes the new
    // folder-B note to be prepended into the folder-A list.
    const { notes } = useNoteStore.getState();
    const strayNotes = notes.filter((n) => n.folderId !== 'folder-A');
    expect(strayNotes).toEqual([]);
  });
});
