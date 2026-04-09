import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createExpoCompatibleDb } from '../test-utils';
import {
  createNotebook,
  getNotebooks,
  updateNotebook,
  renameNotebook,
  deleteNotebook,
  seedSampleNotebook,
} from '../operations/notebooks';
import { createNote, getNotes } from '../operations/notes';

describe('notebooks operations', () => {
  let db: ReturnType<typeof createExpoCompatibleDb>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01'));
    db = createExpoCompatibleDb();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('createNotebook returns a notebook with correct shape and id', async () => {
    const notebook = await createNotebook(db, 'Work');

    expect(notebook).toMatchObject({
      name: 'Work',
      syncedAt: null,
    });
    expect(typeof notebook.id).toBe('string');
    expect(notebook.id.length).toBeGreaterThan(0);
    expect(typeof notebook.createdAt).toBe('number');
    expect(typeof notebook.updatedAt).toBe('number');
  });

  it('createNotebook sets createdAt and updatedAt to current timestamp', async () => {
    const expectedNow = new Date('2024-01-01').getTime();
    const notebook = await createNotebook(db, 'Personal');

    expect(notebook.createdAt).toBe(expectedNow);
    expect(notebook.updatedAt).toBe(expectedNow);
  });

  it('getNotebooks returns all notebooks ordered by sort_order ASC, created_at ASC', async () => {
    // Create first notebook at T=0
    const nb1 = await createNotebook(db, 'Alpha');

    // Advance time so the second notebook has a later created_at
    vi.setSystemTime(new Date('2024-01-02'));
    const nb2 = await createNotebook(db, 'Beta');

    const notebooks = await getNotebooks(db);

    expect(notebooks).toHaveLength(2);
    // Both have sort_order=0, tiebreaker is created_at ASC → nb1 first
    expect(notebooks[0].id).toBe(nb1.id);
    expect(notebooks[1].id).toBe(nb2.id);
  });

  it('getNotebooks returns empty array when no notebooks exist', async () => {
    const notebooks = await getNotebooks(db);

    expect(notebooks).toEqual([]);
  });

  it('updateNotebook changes the name and updates updated_at', async () => {
    const notebook = await createNotebook(db, 'Old Name');

    // Advance time so updated_at changes
    vi.setSystemTime(new Date('2024-06-01'));
    const updatedNow = new Date('2024-06-01').getTime();

    await updateNotebook(db, notebook.id, 'New Name');

    const [updated] = await getNotebooks(db);
    expect(updated.name).toBe('New Name');
    expect(updated.updatedAt).toBe(updatedNow);
  });

  it('renameNotebook updates the name and updated_at', async () => {
    const notebook = await createNotebook(db, 'Old');

    vi.setSystemTime(new Date('2024-07-15'));
    const expectedNow = new Date('2024-07-15').getTime();
    await renameNotebook(db, notebook.id, 'Renamed');

    const [updated] = await getNotebooks(db);
    expect(updated.name).toBe('Renamed');
    expect(updated.updatedAt).toBe(expectedNow);
  });

  it('deleteNotebook removes the notebook', async () => {
    const notebook = await createNotebook(db, 'Temp');

    await deleteNotebook(db, notebook.id);

    const notebooks = await getNotebooks(db);
    expect(notebooks).toHaveLength(0);
  });

  it('deleteNotebook cascades: also removes notes in that notebook', async () => {
    const notebook = await createNotebook(db, 'To Delete');
    await createNote(db, notebook.id);
    await createNote(db, notebook.id);

    await deleteNotebook(db, notebook.id);

    // After cascade delete all notes belonging to this notebook must be gone
    const notes = await db.getAllAsync(
      'SELECT * FROM notes WHERE notebook_id = ?',
      [notebook.id],
    );
    expect(notes).toHaveLength(0);
  });

  it('seedSampleNotebook creates 1 notebook and 3 notes', async () => {
    const nb = await seedSampleNotebook(db);

    expect(nb.name).toBe('Getting Started');

    const notes = await getNotes(db, nb.id);
    expect(notes).toHaveLength(3);
  });

  it('seedSampleNotebook is idempotent — calling twice does not duplicate', async () => {
    const nb1 = await seedSampleNotebook(db);
    const nb2 = await seedSampleNotebook(db);

    expect(nb1.id).toBe(nb2.id);

    const notebooks = await getNotebooks(db);
    const gettingStarted = notebooks.filter((n) => n.name === 'Getting Started');
    expect(gettingStarted).toHaveLength(1);
  });

  it('seedSampleNotebook notes have valid markdown bodies', async () => {
    const nb = await seedSampleNotebook(db);
    const notes = await getNotes(db, nb.id);

    for (const note of notes) {
      expect(note.body.length).toBeGreaterThan(0);
      expect(note.body).toContain('#');
    }
  });
});
