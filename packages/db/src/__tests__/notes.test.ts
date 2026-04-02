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

  it('createNote sets isDirty to 0', async () => {
    const notebook = await createNotebook(db, 'Work');
    const note = await createNote(db, notebook.id);

    expect(note.isDirty).toBe(0);
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

  it('getNotes returns notes ordered by updated_at DESC', async () => {
    const notebook = await createNotebook(db, 'Work');

    const note1 = await createNote(db, notebook.id);

    vi.setSystemTime(new Date('2024-03-01'));
    const note2 = await createNote(db, notebook.id);

    vi.setSystemTime(new Date('2024-02-01'));
    const note3 = await createNote(db, notebook.id);

    const notes = await getNotes(db, notebook.id);

    // Most recently created/updated first
    expect(notes[0].id).toBe(note2.id);
    expect(notes[1].id).toBe(note3.id);
    expect(notes[2].id).toBe(note1.id);
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

  it('searchNotes returns empty array for no match', async () => {
    const notebook = await createNotebook(db, 'Work');
    const note = await createNote(db, notebook.id);
    await updateNote(db, note.id, { title: 'Recipes', body: 'Vanilla sponge cake' });

    const results = await searchNotes(db, notebook.id, 'xylophone');

    expect(results).toEqual([]);
  });
});
