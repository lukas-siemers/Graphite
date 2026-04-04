import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Folder } from '../../../../packages/db/src/types';
import { useFolderStore } from '../use-folder-store';

// ---------------------------------------------------------------------------
// Mock @graphite/db so getFolders never touches SQLite.
// The mock returns different folder arrays depending on the notebookId supplied
// so that multi-notebook merge behavior can be verified.
// ---------------------------------------------------------------------------

const folderA1: Folder = {
  id: 'f-a1',
  notebookId: 'nb-a',
  parentId: null,
  name: 'Alpha',
  createdAt: 1700000000000,
  updatedAt: 1700000000000,
};

const folderA2: Folder = {
  id: 'f-a2',
  notebookId: 'nb-a',
  parentId: null,
  name: 'Alpha Refresh',
  createdAt: 1700000000001,
  updatedAt: 1700000000001,
};

const folderB1: Folder = {
  id: 'f-b1',
  notebookId: 'nb-b',
  parentId: null,
  name: 'Beta',
  createdAt: 1700000000002,
  updatedAt: 1700000000002,
};

// Each call to getFolders returns a different set per notebook id.
vi.mock('@graphite/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@graphite/db')>();
  return {
    ...actual,
    getFolders: vi.fn((_db: unknown, notebookId: string) => {
      if (notebookId === 'nb-a') return Promise.resolve([folderA1]);
      if (notebookId === 'nb-b') return Promise.resolve([folderB1]);
      return Promise.resolve([]);
    }),
    createFolder: vi.fn(),
    deleteFolder: vi.fn(),
  };
});

// Minimal fake DB object — all DB calls are intercepted by the mock above.
const fakeDb = {} as any;

describe('useFolderStore', () => {
  beforeEach(() => {
    useFolderStore.setState({ folders: [], activeFolderId: null });
  });

  // -------------------------------------------------------------------------
  // Basic initial state
  // -------------------------------------------------------------------------

  it('initial state: folders is empty array', () => {
    expect(useFolderStore.getState().folders).toEqual([]);
  });

  it('initial state: activeFolderId is null', () => {
    expect(useFolderStore.getState().activeFolderId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // setFolders — full replace
  // -------------------------------------------------------------------------

  it('setFolders: replaces the entire folders array', () => {
    useFolderStore.getState().setFolders([folderA1, folderB1]);
    expect(useFolderStore.getState().folders).toEqual([folderA1, folderB1]);
  });

  it('setFolders with empty array: resets folders to empty', () => {
    useFolderStore.getState().setFolders([folderA1, folderB1]);
    useFolderStore.getState().setFolders([]);
    expect(useFolderStore.getState().folders).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // loadFolders — regression: merge, not replace
  //
  // Before the fix, loadFolders called set({ folders: freshFolders }) which
  // wiped all folders belonging to OTHER notebooks whenever any notebook was
  // expanded or collapsed.  The fix changes the setter to a merge keyed on
  // notebookId.
  // -------------------------------------------------------------------------

  it('loadFolders with notebook A populates folders for A', async () => {
    await useFolderStore.getState().loadFolders(fakeDb, 'nb-a');
    const { folders } = useFolderStore.getState();
    expect(folders).toContainEqual(folderA1);
    expect(folders.filter((f) => f.notebookId === 'nb-a')).toHaveLength(1);
  });

  it('loadFolders for notebook B does NOT wipe previously loaded folders for A', async () => {
    // Regression: calling loadFolders for a second notebook used to replace
    // the entire store, making notebook A's folders disappear from the sidebar.
    await useFolderStore.getState().loadFolders(fakeDb, 'nb-a');
    await useFolderStore.getState().loadFolders(fakeDb, 'nb-b');
    const { folders } = useFolderStore.getState();
    // Both notebooks' folders must coexist.
    expect(folders.find((f) => f.id === 'f-a1')).toBeDefined();
    expect(folders.find((f) => f.id === 'f-b1')).toBeDefined();
  });

  it('loadFolders for notebook A a second time replaces A folders without duplicates', async () => {
    // Simulate a refresh: getFolders mock always returns [folderA1] for nb-a.
    // Calling twice must not accumulate duplicates.
    await useFolderStore.getState().loadFolders(fakeDb, 'nb-a');
    await useFolderStore.getState().loadFolders(fakeDb, 'nb-a');
    const { folders } = useFolderStore.getState();
    const aFolders = folders.filter((f) => f.notebookId === 'nb-a');
    expect(aFolders).toHaveLength(1);
    expect(aFolders[0]).toEqual(folderA1);
  });

  it('loadFolders for notebook A replaces stale A folders with fresh ones', async () => {
    // Pre-seed an old folder for nb-a, then loadFolders replaces it with the
    // fresh result from getFolders (which returns [folderA1]).
    const staleFolder: Folder = { ...folderA2, id: 'f-a-stale', notebookId: 'nb-a' };
    useFolderStore.setState({ folders: [staleFolder] });
    await useFolderStore.getState().loadFolders(fakeDb, 'nb-a');
    const { folders } = useFolderStore.getState();
    expect(folders.find((f) => f.id === 'f-a-stale')).toBeUndefined();
    expect(folders.find((f) => f.id === 'f-a1')).toBeDefined();
  });

  it('loadFolders for notebook A does not remove folders belonging to notebook B', async () => {
    // Pre-seed a folder for nb-b before loading nb-a — it must survive.
    useFolderStore.setState({ folders: [folderB1] });
    await useFolderStore.getState().loadFolders(fakeDb, 'nb-a');
    const { folders } = useFolderStore.getState();
    expect(folders.find((f) => f.id === 'f-b1')).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // setActiveFolder
  // -------------------------------------------------------------------------

  it('setActiveFolder: updates activeFolderId', () => {
    useFolderStore.getState().setActiveFolder('f-a1');
    expect(useFolderStore.getState().activeFolderId).toBe('f-a1');
  });

  it('setActiveFolder with null: clears activeFolderId', () => {
    useFolderStore.getState().setActiveFolder('f-a1');
    useFolderStore.getState().setActiveFolder(null);
    expect(useFolderStore.getState().activeFolderId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // addFolder / updateFolder / removeFolder
  // -------------------------------------------------------------------------

  it('addFolder: appends to folders array', () => {
    useFolderStore.getState().addFolder(folderA1);
    useFolderStore.getState().addFolder(folderB1);
    const { folders } = useFolderStore.getState();
    expect(folders).toHaveLength(2);
    expect(folders[0]).toEqual(folderA1);
    expect(folders[1]).toEqual(folderB1);
  });

  it('updateFolder: patches matching folder, leaves others unchanged', () => {
    useFolderStore.getState().setFolders([folderA1, folderB1]);
    useFolderStore.getState().updateFolder('f-a1', { name: 'Renamed Alpha' });
    const { folders } = useFolderStore.getState();
    expect(folders.find((f) => f.id === 'f-a1')?.name).toBe('Renamed Alpha');
    expect(folders.find((f) => f.id === 'f-b1')).toEqual(folderB1);
  });

  it('removeFolder: removes folder with matching id', () => {
    useFolderStore.getState().setFolders([folderA1, folderB1]);
    useFolderStore.getState().removeFolder('f-a1');
    const { folders } = useFolderStore.getState();
    expect(folders.find((f) => f.id === 'f-a1')).toBeUndefined();
    expect(folders).toHaveLength(1);
    expect(folders[0]).toEqual(folderB1);
  });
});
