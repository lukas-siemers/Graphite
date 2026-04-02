import { describe, it, expect, beforeEach } from 'vitest';
import type { Notebook } from '../../../../packages/db/src/types';
import { useNotebookStore } from '../use-notebook-store';

// Fixed test fixtures
const nb1: Notebook = {
  id: 'nb-1',
  name: 'Work',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
  syncedAt: null,
};

const nb2: Notebook = {
  id: 'nb-2',
  name: 'Personal',
  createdAt: 1700000000001,
  updatedAt: 1700000000001,
  syncedAt: null,
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
});
