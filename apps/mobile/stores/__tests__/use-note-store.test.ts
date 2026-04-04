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
  createdAt: 1700000000001,
  updatedAt: 1700000000001,
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
