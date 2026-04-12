/**
 * Tests for the web/Electron remote-change adapter inside
 * `useSyncEngine`.
 *
 * We test `applyRemoteToStore` directly — the hook itself wires React
 * state + AppState listeners and isn't easily exercised in a Node
 * environment without a DOM. The adapter is the piece Stage 4 added to
 * unblock desktop sync: on the Electron renderer the local DB is a
 * noop, so remote rows land in the Zustand stores instead of the
 * (unavailable) SQLite round-trip.
 *
 * The tests pass in minimal Zustand-store mocks (just `getState` +
 * `setState`) rather than importing the real stores so we don't drag
 * the rest of the app's state machine into scope.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { applyRemoteToStore } from '../apply-remote-to-store';

type Any = Record<string, unknown>;

// Minimal Zustand-ish store stub. Mirrors the `.getState()` / `.setState()`
// API the hook uses.
function makeStore<T extends Any>(initial: T) {
  let state = initial;
  return {
    getState: () => state,
    setState: (updater: ((s: T) => Partial<T>) | Partial<T>) => {
      const patch = typeof updater === 'function' ? updater(state) : updater;
      state = { ...state, ...patch };
    },
  };
}

function makeNoteStore(notes: Array<Any> = []) {
  const store = makeStore({
    notes,
    activeNoteId: null as string | null,
  });
  return {
    ...store,
    getState: () => ({
      ...store.getState(),
      removeNote: (id: string) =>
        store.setState((s) => ({ notes: s.notes.filter((n) => (n as Any).id !== id) })),
      addNote: (n: Any) =>
        store.setState((s) => ({ notes: [...s.notes, n] })),
      updateNote: (id: string, patch: Any) =>
        store.setState((s) => ({
          notes: s.notes.map((x) => ((x as Any).id === id ? { ...(x as Any), ...patch } : x)),
        })),
      setActiveNote: (id: string | null) => store.setState({ activeNoteId: id }),
    }),
  };
}

function makeNotebookStore(notebooks: Array<Any> = []) {
  return makeStore({
    notebooks,
    activeNotebookId: null as string | null,
  });
}

function makeFolderStore(folders: Array<Any> = []) {
  return makeStore({ folders });
}

let notebookStore: ReturnType<typeof makeNotebookStore>;
let folderStore: ReturnType<typeof makeFolderStore>;
let noteStore: ReturnType<typeof makeNoteStore>;

beforeEach(() => {
  notebookStore = makeNotebookStore();
  folderStore = makeFolderStore();
  noteStore = makeNoteStore();
});

describe('applyRemoteToStore — notes', () => {
  it('INSERT adds a new note to an empty store', () => {
    applyRemoteToStore(
      'notes',
      'INSERT',
      {
        id: 'n1',
        folder_id: null,
        notebook_id: 'nb1',
        title: 'Hello',
        body: 'body',
        canvas_json: null,
        sort_order: 0,
        created_at: 1000,
        updated_at: 2000,
      },
      notebookStore,
      folderStore,
      noteStore,
    );
    const { notes } = noteStore.getState();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id: 'n1',
      notebookId: 'nb1',
      title: 'Hello',
      body: 'body',
      canvasJson: null,
      isDirty: 0,
      sortOrder: 0,
      createdAt: 1000,
      updatedAt: 2000,
    });
  });

  it('UPDATE replaces an existing note in place', () => {
    noteStore = makeNoteStore([
      {
        id: 'n1',
        notebookId: 'nb1',
        title: 'Old',
        body: 'old',
        canvasJson: null,
        isDirty: 1,
        sortOrder: 0,
        createdAt: 1000,
        updatedAt: 1000,
      },
    ]);
    applyRemoteToStore(
      'notes',
      'UPDATE',
      {
        id: 'n1',
        notebook_id: 'nb1',
        title: 'New',
        body: 'new',
        canvas_json: '{"v":1}',
        sort_order: 1,
        created_at: 1000,
        updated_at: 3000,
      },
      notebookStore,
      folderStore,
      noteStore,
    );
    const { notes } = noteStore.getState();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      id: 'n1',
      title: 'New',
      body: 'new',
      canvasJson: '{"v":1}',
      updatedAt: 3000,
      isDirty: 0,
    });
  });

  it('DELETE removes a note by id', () => {
    noteStore = makeNoteStore([
      { id: 'a', notebookId: 'nb1' },
      { id: 'b', notebookId: 'nb1' },
    ]);
    applyRemoteToStore(
      'notes',
      'DELETE',
      { id: 'a' },
      notebookStore,
      folderStore,
      noteStore,
    );
    const { notes } = noteStore.getState();
    expect(notes.map((n: Any) => n.id)).toEqual(['b']);
  });

  it('sets activeNoteId on first insert so the editor has something to open', () => {
    applyRemoteToStore(
      'notes',
      'INSERT',
      {
        id: 'first',
        notebook_id: 'nb1',
        title: 'First',
        body: '',
        created_at: 1,
        updated_at: 1,
      },
      notebookStore,
      folderStore,
      noteStore,
    );
    expect(noteStore.getState().activeNoteId).toBe('first');
  });

  it('does NOT overwrite an existing activeNoteId', () => {
    noteStore = makeNoteStore();
    noteStore.getState().setActiveNote('existing');
    applyRemoteToStore(
      'notes',
      'INSERT',
      {
        id: 'other',
        notebook_id: 'nb1',
        title: '',
        body: '',
        created_at: 1,
        updated_at: 1,
      },
      notebookStore,
      folderStore,
      noteStore,
    );
    expect(noteStore.getState().activeNoteId).toBe('existing');
  });

  it('marks isDirty=0 regardless of the remote row value', () => {
    applyRemoteToStore(
      'notes',
      'INSERT',
      {
        id: 'n1',
        notebook_id: 'nb1',
        title: 'T',
        body: 'b',
        is_dirty: 1, // remote rows should never be treated as dirty locally
        created_at: 1,
        updated_at: 1,
      },
      notebookStore,
      folderStore,
      noteStore,
    );
    expect((noteStore.getState().notes[0] as Any).isDirty).toBe(0);
  });
});

describe('applyRemoteToStore — notebooks', () => {
  it('INSERT appends and seeds activeNotebookId', () => {
    applyRemoteToStore(
      'notebooks',
      'INSERT',
      {
        id: 'nb1',
        name: 'Work',
        sort_order: 0,
        created_at: 1,
        updated_at: 1,
      },
      notebookStore,
      folderStore,
      noteStore,
    );
    const { notebooks, activeNotebookId } = notebookStore.getState();
    expect(notebooks).toHaveLength(1);
    expect(notebooks[0]).toMatchObject({ id: 'nb1', name: 'Work', isDirty: 0 });
    expect(activeNotebookId).toBe('nb1');
  });

  it('UPDATE patches an existing notebook without clobbering unknown fields', () => {
    notebookStore = makeNotebookStore([
      { id: 'nb1', name: 'Work', sortOrder: 0 },
    ]);
    applyRemoteToStore(
      'notebooks',
      'UPDATE',
      {
        id: 'nb1',
        name: 'Work (renamed)',
        sort_order: 1,
        created_at: 1,
        updated_at: 2,
      },
      notebookStore,
      folderStore,
      noteStore,
    );
    const nb = notebookStore.getState().notebooks[0] as Any;
    expect(nb.name).toBe('Work (renamed)');
    expect(nb.sortOrder).toBe(1);
  });

  it('DELETE removes the notebook and clears activeNotebookId if it matched', () => {
    notebookStore = makeNotebookStore([
      { id: 'nb1', name: 'Work' },
      { id: 'nb2', name: 'Personal' },
    ]);
    notebookStore.setState({ activeNotebookId: 'nb1' });
    applyRemoteToStore(
      'notebooks',
      'DELETE',
      { id: 'nb1' },
      notebookStore,
      folderStore,
      noteStore,
    );
    expect(notebookStore.getState().notebooks.map((n: Any) => n.id)).toEqual(['nb2']);
    expect(notebookStore.getState().activeNotebookId).toBeNull();
  });
});

describe('applyRemoteToStore — folders', () => {
  it('INSERT appends a folder with the right mapping', () => {
    applyRemoteToStore(
      'folders',
      'INSERT',
      {
        id: 'f1',
        notebook_id: 'nb1',
        parent_id: null,
        name: 'Inbox',
        sort_order: 0,
        created_at: 1,
        updated_at: 1,
      },
      notebookStore,
      folderStore,
      noteStore,
    );
    const { folders } = folderStore.getState();
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatchObject({
      id: 'f1',
      notebookId: 'nb1',
      parentId: null,
      name: 'Inbox',
      isDirty: 0,
    });
  });

  it('DELETE removes a folder by id', () => {
    folderStore = makeFolderStore([
      { id: 'f1', name: 'A' },
      { id: 'f2', name: 'B' },
    ]);
    applyRemoteToStore(
      'folders',
      'DELETE',
      { id: 'f1' },
      notebookStore,
      folderStore,
      noteStore,
    );
    expect(folderStore.getState().folders.map((f: Any) => f.id)).toEqual(['f2']);
  });
});

describe('applyRemoteToStore — edge cases', () => {
  it('ignores DELETE with no id (defensive — malformed Realtime payload)', () => {
    noteStore = makeNoteStore([{ id: 'keep', notebookId: 'nb1' }]);
    applyRemoteToStore(
      'notes',
      'DELETE',
      {},
      notebookStore,
      folderStore,
      noteStore,
    );
    expect(noteStore.getState().notes.map((n: Any) => n.id)).toEqual(['keep']);
  });

  it('ignores INSERT with null newRecord', () => {
    applyRemoteToStore(
      'notes',
      'INSERT',
      null,
      notebookStore,
      folderStore,
      noteStore,
    );
    expect(noteStore.getState().notes).toEqual([]);
  });
});
