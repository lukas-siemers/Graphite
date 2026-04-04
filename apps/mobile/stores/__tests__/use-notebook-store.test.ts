import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Notebook } from '../../../../packages/db/src/types';
import { useNotebookStore } from '../use-notebook-store';

// ---------------------------------------------------------------------------
// Mock @graphite/db so async actions never touch expo-sqlite.
// ---------------------------------------------------------------------------

vi.mock('@graphite/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@graphite/db')>();
  return {
    ...actual,
    getNotebooks: vi.fn(() => Promise.resolve([])),
    createNotebook: vi.fn(),
    deleteNotebook: vi.fn(() => Promise.resolve()),
    updateNotebookSortOrder: vi.fn(),
  };
});

// Minimal fake DB object — all DB calls are intercepted by the mock above.
const fakeDb = {} as any;

// Fixed test fixtures
const nb1: Notebook = {
  id: 'nb-1',
  name: 'Work',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  syncedAt: null,
  sortOrder: 0,
};

const nb2: Notebook = {
  id: 'nb-2',
  name: 'Personal',
  createdAt: 1700000000001,
  updatedAt: 1700000000001,
  syncedAt: null,
  sortOrder: 1,
};

describe('useNotebookStore', () => {
  beforeEach(() => {
    useNotebookStore.setState({ notebooks: [], activeNotebookId: null });
  });

  it('initial state: notebooks is empty array', () => {
    const { notebooks } = useNotebookStore.getState();
    expect(notebooks).toEqual([]);
  });

  it('initial state: activeNotebookId is null', () => {
    const { activeNotebookId } = useNotebookStore.getState();
    expect(activeNotebookId).toBeNull();
  });

  it('setNotebooks: replaces the notebooks array', () => {
    useNotebookStore.getState().setNotebooks([nb1, nb2]);
    const { notebooks } = useNotebookStore.getState();
    expect(notebooks).toEqual([nb1, nb2]);
  });

  it('setActiveNotebook: updates activeNotebookId', () => {
    useNotebookStore.getState().setActiveNotebook('nb-1');
    expect(useNotebookStore.getState().activeNotebookId).toBe('nb-1');
  });

  it('addNotebook: appends to notebooks array', () => {
    useNotebookStore.getState().addNotebook(nb1);
    useNotebookStore.getState().addNotebook(nb2);
    const { notebooks } = useNotebookStore.getState();
    expect(notebooks).toHaveLength(2);
    expect(notebooks[0]).toEqual(nb1);
    expect(notebooks[1]).toEqual(nb2);
  });

  it('updateNotebook: patches matching notebook by id, leaves others unchanged', () => {
    useNotebookStore.getState().setNotebooks([nb1, nb2]);
    useNotebookStore.getState().updateNotebook('nb-1', { name: 'Work Updated', updatedAt: 1700000001000 });
    const { notebooks } = useNotebookStore.getState();
    const updated = notebooks.find((n) => n.id === 'nb-1');
    expect(updated?.name).toBe('Work Updated');
    expect(updated?.updatedAt).toBe(1700000001000);
  });

  it('updateNotebook: does not mutate unrelated notebooks', () => {
    useNotebookStore.getState().setNotebooks([nb1, nb2]);
    useNotebookStore.getState().updateNotebook('nb-1', { name: 'Changed' });
    const { notebooks } = useNotebookStore.getState();
    const untouched = notebooks.find((n) => n.id === 'nb-2');
    expect(untouched).toEqual(nb2);
  });

  it('removeNotebook: removes notebook with matching id', () => {
    useNotebookStore.getState().setNotebooks([nb1, nb2]);
    useNotebookStore.getState().removeNotebook('nb-1');
    const { notebooks } = useNotebookStore.getState();
    expect(notebooks.find((n) => n.id === 'nb-1')).toBeUndefined();
  });

  it('removeNotebook: leaves other notebooks intact', () => {
    useNotebookStore.getState().setNotebooks([nb1, nb2]);
    useNotebookStore.getState().removeNotebook('nb-1');
    const { notebooks } = useNotebookStore.getState();
    expect(notebooks).toHaveLength(1);
    expect(notebooks[0]).toEqual(nb2);
  });

  // -------------------------------------------------------------------------
  // deleteNotebook — async action that calls the DB and updates store state
  // -------------------------------------------------------------------------

  it('deleteNotebook removes the notebook from the notebooks array', async () => {
    useNotebookStore.getState().setNotebooks([nb1, nb2]);
    await useNotebookStore.getState().deleteNotebook(fakeDb, 'nb-1');
    const { notebooks } = useNotebookStore.getState();
    expect(notebooks.find((n) => n.id === 'nb-1')).toBeUndefined();
    expect(notebooks).toHaveLength(1);
    expect(notebooks[0]).toEqual(nb2);
  });

  it('deleteNotebook clears activeNotebookId when the deleted notebook was active', async () => {
    useNotebookStore.setState({ notebooks: [nb1, nb2], activeNotebookId: 'nb-1' });
    await useNotebookStore.getState().deleteNotebook(fakeDb, 'nb-1');
    expect(useNotebookStore.getState().activeNotebookId).toBeNull();
  });

  it('deleteNotebook does NOT clear activeNotebookId when a different notebook is active', async () => {
    useNotebookStore.setState({ notebooks: [nb1, nb2], activeNotebookId: 'nb-2' });
    await useNotebookStore.getState().deleteNotebook(fakeDb, 'nb-1');
    expect(useNotebookStore.getState().activeNotebookId).toBe('nb-2');
  });

  // -------------------------------------------------------------------------
  // moveNotebookUp / moveNotebookDown
  // -------------------------------------------------------------------------

  it('moveNotebookUp swaps sort_order with the previous notebook', async () => {
    // nb1 has sortOrder 0, nb2 has sortOrder 1 — moving nb2 up should swap them.
    useNotebookStore.getState().setNotebooks([nb1, nb2]);
    await useNotebookStore.getState().moveNotebookUp(fakeDb, 'nb-2');
    const { notebooks } = useNotebookStore.getState();
    const movedUp = notebooks.find((n) => n.id === 'nb-2');
    const movedDown = notebooks.find((n) => n.id === 'nb-1');
    expect(movedUp?.sortOrder).toBe(0);
    expect(movedDown?.sortOrder).toBe(1);
  });

  it('moveNotebookDown swaps sort_order with the next notebook', async () => {
    // nb1 has sortOrder 0, nb2 has sortOrder 1 — moving nb1 down should swap them.
    useNotebookStore.getState().setNotebooks([nb1, nb2]);
    await useNotebookStore.getState().moveNotebookDown(fakeDb, 'nb-1');
    const { notebooks } = useNotebookStore.getState();
    const movedDown = notebooks.find((n) => n.id === 'nb-1');
    const movedUp = notebooks.find((n) => n.id === 'nb-2');
    expect(movedDown?.sortOrder).toBe(1);
    expect(movedUp?.sortOrder).toBe(0);
  });

  it('moveNotebookUp does nothing when notebook is already first', async () => {
    useNotebookStore.getState().setNotebooks([nb1, nb2]);
    await useNotebookStore.getState().moveNotebookUp(fakeDb, 'nb-1');
    const { notebooks } = useNotebookStore.getState();
    // Sort orders must be unchanged.
    expect(notebooks.find((n) => n.id === 'nb-1')?.sortOrder).toBe(0);
    expect(notebooks.find((n) => n.id === 'nb-2')?.sortOrder).toBe(1);
  });

  it('moveNotebookDown does nothing when notebook is already last', async () => {
    useNotebookStore.getState().setNotebooks([nb1, nb2]);
    await useNotebookStore.getState().moveNotebookDown(fakeDb, 'nb-2');
    const { notebooks } = useNotebookStore.getState();
    // Sort orders must be unchanged.
    expect(notebooks.find((n) => n.id === 'nb-1')?.sortOrder).toBe(0);
    expect(notebooks.find((n) => n.id === 'nb-2')?.sortOrder).toBe(1);
  });
});
