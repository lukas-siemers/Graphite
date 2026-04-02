import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createExpoCompatibleDb } from '../test-utils';
import { createNotebook } from '../operations/notebooks';
import {
  createFolder,
  getFolders,
  updateFolder,
  deleteFolder,
} from '../operations/folders';

describe('folders operations', () => {
  let db: ReturnType<typeof createExpoCompatibleDb>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01'));
    db = createExpoCompatibleDb();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('createFolder returns folder with correct notebookId', async () => {
    const notebook = await createNotebook(db, 'Work');
    const folder = await createFolder(db, notebook.id, 'Projects');

    expect(folder.notebookId).toBe(notebook.id);
    expect(folder.name).toBe('Projects');
    expect(typeof folder.id).toBe('string');
    expect(folder.id.length).toBeGreaterThan(0);
    expect(folder.parentId).toBeNull();
  });

  it('createFolder with parentId sets parentId correctly', async () => {
    const notebook = await createNotebook(db, 'Work');
    const parent = await createFolder(db, notebook.id, 'Projects');
    const child = await createFolder(db, notebook.id, 'Active', parent.id);

    expect(child.parentId).toBe(parent.id);
    expect(child.notebookId).toBe(notebook.id);
  });

  it('getFolders returns only folders for the specified notebook', async () => {
    const nb1 = await createNotebook(db, 'Work');
    const nb2 = await createNotebook(db, 'Personal');

    await createFolder(db, nb1.id, 'Projects');
    await createFolder(db, nb1.id, 'Archive');
    await createFolder(db, nb2.id, 'Journal');

    const nb1Folders = await getFolders(db, nb1.id);
    const nb2Folders = await getFolders(db, nb2.id);

    expect(nb1Folders).toHaveLength(2);
    expect(nb1Folders.every((f) => f.notebookId === nb1.id)).toBe(true);

    expect(nb2Folders).toHaveLength(1);
    expect(nb2Folders[0].notebookId).toBe(nb2.id);
  });

  it('updateFolder changes the name', async () => {
    const notebook = await createNotebook(db, 'Work');
    const folder = await createFolder(db, notebook.id, 'Old Name');

    vi.setSystemTime(new Date('2024-06-01'));
    await updateFolder(db, folder.id, 'New Name');

    const folders = await getFolders(db, notebook.id);
    const updated = folders.find((f) => f.id === folder.id)!;
    expect(updated.name).toBe('New Name');
  });

  it('deleteFolder removes the folder', async () => {
    const notebook = await createNotebook(db, 'Work');
    const folder = await createFolder(db, notebook.id, 'Temp');

    await deleteFolder(db, folder.id);

    const folders = await getFolders(db, notebook.id);
    expect(folders.find((f) => f.id === folder.id)).toBeUndefined();
  });
});
