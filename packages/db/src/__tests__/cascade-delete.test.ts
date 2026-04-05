import { describe, it, expect, beforeEach } from 'vitest';
import { createExpoCompatibleDb } from '../test-utils';
import { createNotebook } from '../operations/notebooks';
import { createFolder } from '../operations/folders';
import { createNote } from '../operations/notes';
import {
  deleteFolder,
  countFolderContents,
} from '../operations/folders';
import {
  deleteNotebook,
  countNotebookContents,
} from '../operations/notebooks';

describe('cascade delete operations', () => {
  let db: ReturnType<typeof createExpoCompatibleDb>;

  beforeEach(() => {
    db = createExpoCompatibleDb();
  });

  it('deleteFolder removes nested subfolders and all their notes', async () => {
    const nb = await createNotebook(db, 'Work');
    const root = await createFolder(db, nb.id, 'Root');
    const child = await createFolder(db, nb.id, 'Child', root.id);
    const grandchild = await createFolder(db, nb.id, 'Grandchild', child.id);
    // Sibling folder that must NOT be deleted
    const sibling = await createFolder(db, nb.id, 'Sibling');

    await createNote(db, nb.id, root.id);
    await createNote(db, nb.id, child.id);
    await createNote(db, nb.id, child.id);
    await createNote(db, nb.id, grandchild.id);
    const survivor = await createNote(db, nb.id, sibling.id);

    const counts = await countFolderContents(db, root.id);
    expect(counts.folderCount).toBe(2); // child + grandchild
    expect(counts.noteCount).toBe(4);

    const { deletedFolderIds, deletedNoteIds } = await deleteFolder(db, root.id);
    expect(deletedFolderIds).toHaveLength(3);
    expect(deletedNoteIds).toHaveLength(4);

    const remainingFolders = await db.getAllAsync<{ id: string }>(
      'SELECT id FROM folders',
    );
    expect(remainingFolders.map((r: { id: string }) => r.id)).toEqual([sibling.id]);

    const remainingNotes = await db.getAllAsync<{ id: string }>(
      'SELECT id FROM notes',
    );
    expect(remainingNotes.map((r: { id: string }) => r.id)).toEqual([survivor.id]);
  });

  it('deleteFolder on an empty folder removes only the folder', async () => {
    const nb = await createNotebook(db, 'Work');
    const f = await createFolder(db, nb.id, 'Empty');
    const counts = await countFolderContents(db, f.id);
    expect(counts.folderCount).toBe(0);
    expect(counts.noteCount).toBe(0);

    const res = await deleteFolder(db, f.id);
    expect(res.deletedFolderIds).toEqual([f.id]);
    expect(res.deletedNoteIds).toEqual([]);

    const remaining = await db.getAllAsync<{ id: string }>('SELECT id FROM folders');
    expect(remaining).toHaveLength(0);
  });

  it('deleteNotebook cascades to all folders and notes, leaves other notebooks alone', async () => {
    const nb1 = await createNotebook(db, 'Work');
    const nb2 = await createNotebook(db, 'Personal');

    const f1 = await createFolder(db, nb1.id, 'F1');
    const f2 = await createFolder(db, nb1.id, 'F2');
    for (let i = 0; i < 3; i++) await createNote(db, nb1.id, f1.id);
    for (let i = 0; i < 3; i++) await createNote(db, nb1.id, f2.id);

    const otherFolder = await createFolder(db, nb2.id, 'Other');
    const otherNote = await createNote(db, nb2.id, otherFolder.id);

    const counts = await countNotebookContents(db, nb1.id);
    expect(counts.folderCount).toBe(2);
    expect(counts.noteCount).toBe(6);

    const res = await deleteNotebook(db, nb1.id);
    expect(res.deletedFolderIds).toHaveLength(2);
    expect(res.deletedNoteIds).toHaveLength(6);

    const notebooks = await db.getAllAsync<{ id: string }>('SELECT id FROM notebooks');
    expect(notebooks.map((r: { id: string }) => r.id)).toEqual([nb2.id]);

    const folders = await db.getAllAsync<{ id: string }>('SELECT id FROM folders');
    expect(folders.map((r: { id: string }) => r.id)).toEqual([otherFolder.id]);

    const notes = await db.getAllAsync<{ id: string }>('SELECT id FROM notes');
    expect(notes.map((r: { id: string }) => r.id)).toEqual([otherNote.id]);
  });

  it('deleteNotebook rolls back the entire cascade if any step fails', async () => {
    const nb = await createNotebook(db, 'Work');
    const f = await createFolder(db, nb.id, 'F');
    await createNote(db, nb.id, f.id);
    await createNote(db, nb.id, f.id);

    // Monkey-patch runAsync to throw on the final notebooks DELETE so the
    // transaction rolls back after notes + folders have already been deleted
    // within the same transaction.
    const originalRun = db.runAsync;
    let callCount = 0;
    db.runAsync = async (sql: string, params: any[] = []) => {
      callCount++;
      if (sql.startsWith('DELETE FROM notebooks')) {
        throw new Error('simulated failure');
      }
      return originalRun(sql, params);
    };

    await expect(deleteNotebook(db, nb.id)).rejects.toThrow('simulated failure');

    // Restore for assertions
    db.runAsync = originalRun;

    const notebooks = await db.getAllAsync<{ id: string }>('SELECT id FROM notebooks');
    const folders = await db.getAllAsync<{ id: string }>('SELECT id FROM folders');
    const notes = await db.getAllAsync<{ id: string }>('SELECT id FROM notes');
    expect(notebooks).toHaveLength(1);
    expect(folders).toHaveLength(1);
    expect(notes).toHaveLength(2);
  });
});
