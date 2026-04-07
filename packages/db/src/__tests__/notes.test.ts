import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createExpoCompatibleDb } from '../test-utils';
import { createNotebook } from '../operations/notebooks';
import { createFolder } from '../operations/folders';
import {
  createNote,
  getNotes,
  getNote,
  updateNote,
  deleteNote,
  searchNotes,
  moveNote,
  moveNoteToNotebook,
  searchNotesEnhanced,
  getDirtyNotes,
  markNoteClean,
  applyRemoteNote,
} from '../operations/notes';

describe('notes operations', () => {
  let db: ReturnType<typeof createExpoCompatibleDb>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01'));
    db = createExpoCompatibleDb();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('createNote returns note with title Untitled and empty body', async () => {
    const notebook = await createNotebook(db, 'Work');
    const note = await createNote(db, notebook.id);

    expect(note.title).toBe('Untitled');
    expect(note.body).toBe('');
    expect(note.notebookId).toBe(notebook.id);
    expect(typeof note.id).toBe('string');
    expect(note.id.length).toBeGreaterThan(0);
  });

  it('createNote sets isDirty to 1', async () => {
    const notebook = await createNotebook(db, 'Work');
    const note = await createNote(db, notebook.id);

    expect(note.isDirty).toBe(1);
  });

  it('getNotes returns notes for the correct notebook', async () => {
    const nb1 = await createNotebook(db, 'Work');
    const nb2 = await createNotebook(db, 'Personal');

    await createNote(db, nb1.id);
    await createNote(db, nb1.id);
    await createNote(db, nb2.id);

    const nb1Notes = await getNotes(db, nb1.id);
    const nb2Notes = await getNotes(db, nb2.id);

    expect(nb1Notes).toHaveLength(2);
    expect(nb1Notes.every((n) => n.notebookId === nb1.id)).toBe(true);
    expect(nb2Notes).toHaveLength(1);
    expect(nb2Notes[0].notebookId).toBe(nb2.id);
  });

  it("getNotes filtered by folderId returns only that folder's notes", async () => {
    const notebook = await createNotebook(db, 'Work');
    const folder = await createFolder(db, notebook.id, 'Projects');

    await createNote(db, notebook.id, folder.id);
    await createNote(db, notebook.id, folder.id);
    await createNote(db, notebook.id); // no folder

    const folderNotes = await getNotes(db, notebook.id, folder.id);

    expect(folderNotes).toHaveLength(2);
    expect(folderNotes.every((n) => n.folderId === folder.id)).toBe(true);
  });

  it('getNotes returns notes ordered by sort_order ASC (tiebreak: updated_at DESC)', async () => {
    const notebook = await createNotebook(db, 'Work');

    // createNote now assigns an incrementing sort_order per bucket, so
    // insertion order determines the primary sort. updated_at only breaks
    // ties when sort_order values collide.
    const note1 = await createNote(db, notebook.id);

    vi.setSystemTime(new Date('2024-03-01'));
    const note2 = await createNote(db, notebook.id);

    vi.setSystemTime(new Date('2024-02-01'));
    const note3 = await createNote(db, notebook.id);

    const notes = await getNotes(db, notebook.id);

    // Primary: sort_order ASC — insertion order.
    expect(notes[0].id).toBe(note1.id);
    expect(notes[1].id).toBe(note2.id);
    expect(notes[2].id).toBe(note3.id);
  });

  it('getNote returns the correct note by id', async () => {
    const notebook = await createNotebook(db, 'Work');
    const created = await createNote(db, notebook.id);

    const fetched = await getNote(db, created.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.notebookId).toBe(notebook.id);
  });

  it('getNote returns null for nonexistent id', async () => {
    const result = await getNote(db, 'does-not-exist');

    expect(result).toBeNull();
  });

  it('updateNote patches title and body', async () => {
    const notebook = await createNotebook(db, 'Work');
    const note = await createNote(db, notebook.id);

    await updateNote(db, note.id, { title: 'My Title', body: '# Hello World' });

    const updated = await getNote(db, note.id);
    expect(updated!.title).toBe('My Title');
    expect(updated!.body).toBe('# Hello World');
  });

  it('updateNote updates updated_at', async () => {
    const notebook = await createNotebook(db, 'Work');
    const note = await createNote(db, notebook.id);

    vi.setSystemTime(new Date('2024-06-15'));
    const expectedUpdatedAt = new Date('2024-06-15').getTime();

    await updateNote(db, note.id, { title: 'Updated' });

    const updated = await getNote(db, note.id);
    expect(updated!.updatedAt).toBe(expectedUpdatedAt);
  });

  it('deleteNote removes the note', async () => {
    const notebook = await createNotebook(db, 'Work');
    const note = await createNote(db, notebook.id);

    await deleteNote(db, note.id);

    const result = await getNote(db, note.id);
    expect(result).toBeNull();
  });

  it('searchNotes returns notes matching FTS query', async () => {
    const notebook = await createNotebook(db, 'Work');
    const note = await createNote(db, notebook.id);
    await updateNote(db, note.id, {
      title: 'Desserts',
      body: 'Chocolate cake recipe',
    });

    // Also create a note that should NOT appear in results
    const otherNote = await createNote(db, notebook.id);
    await updateNote(db, otherNote.id, { title: 'Shopping list', body: 'Eggs, flour, butter' });

    const results = await searchNotes(db, notebook.id, 'chocolate');

    expect(results.length).toBeGreaterThan(0);
    expect(results.some((n) => n.id === note.id)).toBe(true);
    expect(results.every((n) => n.id !== otherNote.id)).toBe(true);
  });

  it('createNote assigns incrementing sort_order within a folder bucket', async () => {
    const notebook = await createNotebook(db, 'Work');
    const folder = await createFolder(db, notebook.id, 'Projects');

    const first = await createNote(db, notebook.id, folder.id);
    const second = await createNote(db, notebook.id, folder.id);
    const third = await createNote(db, notebook.id, folder.id);

    expect(first.sortOrder).toBe(0);
    expect(second.sortOrder).toBe(1);
    expect(third.sortOrder).toBe(2);
    // Distinct — the core regression we are guarding.
    const orders = new Set([first.sortOrder, second.sortOrder, third.sortOrder]);
    expect(orders.size).toBe(3);
  });

  it('createNote tracks sort_order independently for top-level vs folder buckets', async () => {
    const notebook = await createNotebook(db, 'Work');
    const folder = await createFolder(db, notebook.id, 'Projects');

    const topA = await createNote(db, notebook.id);
    const topB = await createNote(db, notebook.id);
    const inFolderA = await createNote(db, notebook.id, folder.id);
    const inFolderB = await createNote(db, notebook.id, folder.id);

    expect(topA.sortOrder).toBe(0);
    expect(topB.sortOrder).toBe(1);
    expect(inFolderA.sortOrder).toBe(0);
    expect(inFolderB.sortOrder).toBe(1);
  });

  it('moveNote updates folder_id and updated_at', async () => {
    const notebook = await createNotebook(db, 'Work');
    const folderA = await createFolder(db, notebook.id, 'A');
    const folderB = await createFolder(db, notebook.id, 'B');
    const note = await createNote(db, notebook.id, folderA.id);

    vi.setSystemTime(new Date('2024-07-01'));
    const expected = new Date('2024-07-01').getTime();

    const result = await moveNote(db, note.id, folderB.id);

    expect(result.folderId).toBe(folderB.id);
    expect(result.updated_at).toBe(expected);

    const updated = await getNote(db, note.id);
    expect(updated!.folderId).toBe(folderB.id);
    expect(updated!.updatedAt).toBe(expected);

    // Move to null (no folder) works too.
    await moveNote(db, note.id, null);
    const rooted = await getNote(db, note.id);
    expect(rooted!.folderId).toBeNull();
  });

  it('searchNotes returns empty array for no match', async () => {
    const notebook = await createNotebook(db, 'Work');
    const note = await createNote(db, notebook.id);
    await updateNote(db, note.id, { title: 'Recipes', body: 'Vanilla sponge cake' });

    const results = await searchNotes(db, notebook.id, 'xylophone');

    expect(results).toEqual([]);
  });

  it('moveNoteToNotebook updates notebook_id, folder_id, sort_order, and updated_at', async () => {
    const nbA = await createNotebook(db, 'A');
    const nbB = await createNotebook(db, 'B');
    const note = await createNote(db, nbA.id);
    vi.setSystemTime(new Date('2024-06-01'));
    await moveNoteToNotebook(db, note.id, nbB.id, null);
    const moved = await getNote(db, note.id);
    expect(moved).not.toBeNull();
    expect(moved!.notebookId).toBe(nbB.id);
    expect(moved!.folderId).toBeNull();
    expect(moved!.sortOrder).toBe(0);
    expect(moved!.updatedAt).toBe(new Date('2024-06-01').getTime());
  });

  it('moveNoteToNotebook to root (null folder) works', async () => {
    const nbA = await createNotebook(db, 'A');
    const nbB = await createNotebook(db, 'B');
    const folder = await createFolder(db, nbA.id, 'Src');
    const note = await createNote(db, nbA.id, folder.id);
    await moveNoteToNotebook(db, note.id, nbB.id, null);
    const moved = await getNote(db, note.id);
    expect(moved!.notebookId).toBe(nbB.id);
    expect(moved!.folderId).toBeNull();
  });

  it('moveNoteToNotebook assigns correct sort_order (MAX+1)', async () => {
    const nbA = await createNotebook(db, 'A');
    const nbB = await createNotebook(db, 'B');
    await createNote(db, nbB.id);
    await createNote(db, nbB.id);
    const note = await createNote(db, nbA.id);
    await moveNoteToNotebook(db, note.id, nbB.id, null);
    const moved = await getNote(db, note.id);
    expect(moved!.sortOrder).toBe(2);
  });

  it('moveNoteToNotebook to same notebook does not crash', async () => {
    const nb = await createNotebook(db, 'Same');
    const note = await createNote(db, nb.id);
    await moveNoteToNotebook(db, note.id, nb.id, null);
    const same = await getNote(db, note.id);
    expect(same).not.toBeNull();
    expect(same!.notebookId).toBe(nb.id);
  });

  describe('searchNotesEnhanced', () => {
    it('tier 1: FTS5 prefix match returns results', async () => {
      const notebook = await createNotebook(db, 'Work');
      const note = await createNote(db, notebook.id);
      await updateNote(db, note.id, {
        title: 'Chocolate cake',
        body: 'A delicious recipe for chocolate cake',
      });

      const results = await searchNotesEnhanced(db, notebook.id, 'choc');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe(note.id);
    });

    it('tier 2: LIKE substring fallback when FTS5 returns nothing', async () => {
      const notebook = await createNotebook(db, 'Work');
      const note = await createNote(db, notebook.id);
      await updateNote(db, note.id, {
        title: 'Meeting notes',
        body: 'Discussed the xylophone acquisition strategy',
      });

      // FTS5 prefix search for a mid-word substring will fail,
      // but LIKE %xylo% should match.
      const results = await searchNotesEnhanced(db, notebook.id, 'xylo');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe(note.id);
    });

    it('tier 3: results are sorted by fuzzy score descending', async () => {
      const notebook = await createNotebook(db, 'Work');

      const strongMatch = await createNote(db, notebook.id);
      await updateNote(db, strongMatch.id, {
        title: 'function overview',
        body: 'All functions documented here',
      });

      const weakMatch = await createNote(db, notebook.id);
      await updateNote(db, weakMatch.id, {
        title: 'Affinity notes',
        body: 'Some affinity data',
      });

      // "function" starts with "func" — strong FTS5 hit; both contain "f"
      const results = await searchNotesEnhanced(db, notebook.id, 'function');

      expect(results.length).toBeGreaterThan(0);
      // The note titled "function overview" should rank first.
      expect(results[0].id).toBe(strongMatch.id);
    });

    it('returns empty array for empty query', async () => {
      const notebook = await createNotebook(db, 'Work');
      await createNote(db, notebook.id);

      const results = await searchNotesEnhanced(db, notebook.id, '   ');

      expect(results).toEqual([]);
    });
  });

  describe('sync helpers', () => {
    it('updateNote sets is_dirty to 1', async () => {
      const notebook = await createNotebook(db, 'Work');
      const note = await createNote(db, notebook.id);
      // Clean the note first so we can verify updateNote dirties it.
      await markNoteClean(db, note.id);
      const clean = await getNote(db, note.id);
      expect(clean!.isDirty).toBe(0);

      await updateNote(db, note.id, { title: 'Changed' });
      const updated = await getNote(db, note.id);
      expect(updated!.isDirty).toBe(1);
    });

    it('getDirtyNotes returns only dirty rows', async () => {
      const notebook = await createNotebook(db, 'Work');
      const note1 = await createNote(db, notebook.id);
      const note2 = await createNote(db, notebook.id);
      // Clean note1, leave note2 dirty.
      await markNoteClean(db, note1.id);

      const dirty = await getDirtyNotes(db);
      expect(dirty).toHaveLength(1);
      expect(dirty[0].id).toBe(note2.id);
    });

    it('markNoteClean clears dirty and sets synced_at', async () => {
      const notebook = await createNotebook(db, 'Work');
      const note = await createNote(db, notebook.id);
      expect(note.isDirty).toBe(1);

      vi.setSystemTime(new Date('2024-06-01'));
      const expectedSync = new Date('2024-06-01').getTime();
      await markNoteClean(db, note.id);

      const cleaned = await getNote(db, note.id);
      expect(cleaned!.isDirty).toBe(0);
      expect(cleaned!.syncedAt).toBe(expectedSync);
    });

    it('applyRemoteNote inserts a new remote note', async () => {
      const notebook = await createNotebook(db, 'Work');
      const remoteId = 'remote-note-123';
      const now = Date.now();

      await applyRemoteNote(db, {
        id: remoteId,
        folder_id: null,
        notebook_id: notebook.id,
        title: 'From Remote',
        body: 'Remote body',
        created_at: now,
        updated_at: now,
      });

      const fetched = await getNote(db, remoteId);
      expect(fetched).not.toBeNull();
      expect(fetched!.title).toBe('From Remote');
      expect(fetched!.body).toBe('Remote body');
      expect(fetched!.isDirty).toBe(0);
      expect(fetched!.syncedAt).not.toBeNull();
    });

    it('applyRemoteNote resolves conflict — remote newer wins', async () => {
      const notebook = await createNotebook(db, 'Work');
      const note = await createNote(db, notebook.id);
      await updateNote(db, note.id, { title: 'Local Title', body: 'Local body' });

      // Remote has a later timestamp.
      vi.setSystemTime(new Date('2025-01-01'));
      const remoteUpdatedAt = new Date('2025-01-01').getTime();

      await applyRemoteNote(db, {
        id: note.id,
        folder_id: null,
        notebook_id: notebook.id,
        title: 'Remote Title',
        body: 'Remote body',
        created_at: note.createdAt,
        updated_at: remoteUpdatedAt,
      });

      const result = await getNote(db, note.id);
      expect(result!.title).toBe('Remote Title');
      expect(result!.body).toBe('Remote body');
      expect(result!.isDirty).toBe(0);
    });

    it('applyRemoteNote resolves conflict — local newer preserved', async () => {
      const notebook = await createNotebook(db, 'Work');
      const note = await createNote(db, notebook.id);

      vi.setSystemTime(new Date('2025-01-01'));
      await updateNote(db, note.id, { title: 'Local Title', body: 'Local body' });

      // Remote has an older timestamp than the local update.
      const olderTimestamp = new Date('2024-06-01').getTime();

      await applyRemoteNote(db, {
        id: note.id,
        folder_id: null,
        notebook_id: notebook.id,
        title: 'Old Remote Title',
        body: 'Old Remote body',
        created_at: note.createdAt,
        updated_at: olderTimestamp,
      });

      const result = await getNote(db, note.id);
      expect(result!.title).toBe('Local Title');
      expect(result!.body).toBe('Local body');
      expect(result!.isDirty).toBe(1);
    });

    it('applyRemoteNote maintains FTS index for new inserts', async () => {
      const notebook = await createNotebook(db, 'Work');
      const remoteId = 'remote-fts-note';
      const now = Date.now();

      await applyRemoteNote(db, {
        id: remoteId,
        folder_id: null,
        notebook_id: notebook.id,
        title: 'Searchable Remote',
        body: 'Unique xylophone content',
        created_at: now,
        updated_at: now,
      });

      const results = await searchNotes(db, notebook.id, 'xylophone');
      expect(results.length).toBe(1);
      expect(results[0].id).toBe(remoteId);
    });

    it('moveNote sets is_dirty to 1', async () => {
      const notebook = await createNotebook(db, 'Work');
      const folderA = await createFolder(db, notebook.id, 'A');
      const folderB = await createFolder(db, notebook.id, 'B');
      const note = await createNote(db, notebook.id, folderA.id);
      await markNoteClean(db, note.id);

      await moveNote(db, note.id, folderB.id);
      const moved = await getNote(db, note.id);
      expect(moved!.isDirty).toBe(1);
    });

    it('moveNoteToNotebook sets is_dirty to 1', async () => {
      const nbA = await createNotebook(db, 'A');
      const nbB = await createNotebook(db, 'B');
      const note = await createNote(db, nbA.id);
      await markNoteClean(db, note.id);

      await moveNoteToNotebook(db, note.id, nbB.id, null);
      const moved = await getNote(db, note.id);
      expect(moved!.isDirty).toBe(1);
    });
  });
});
