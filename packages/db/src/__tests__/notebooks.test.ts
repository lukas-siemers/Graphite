import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createExpoCompatibleDb } from '../test-utils';
import {
  createNotebook,
  getNotebooks,
  updateNotebook,
  renameNotebook,
  deleteNotebook,
  seedSampleNotebook,
  getDirtyNotebooks,
  markNotebookClean,
  applyRemoteNotebook,
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

  it('seedSampleNotebook notes ship as v2 .graphite blobs with ftsBody populated', async () => {
    const nb = await seedSampleNotebook(db);
    const notes = await getNotes(db, nb.id);

    for (const note of notes) {
      // Build 80: seed notes are v2 from the ground up — no legacy body.
      expect(note.canvasVersion).toBe(2);
      expect(note.body).toBe('');
      expect(note.graphiteBlob).not.toBeNull();
      expect((note.graphiteBlob as Uint8Array).byteLength).toBeGreaterThan(0);
      expect(note.ftsBody ?? '').toContain('#');
      expect((note.ftsBody ?? '').length).toBeGreaterThan(0);
    }
  });

  describe('sync helpers', () => {
    it('createNotebook sets isDirty to 1', async () => {
      const nb = await createNotebook(db, 'Work');
      expect(nb.isDirty).toBe(1);
    });

    it('updateNotebook sets isDirty to 1', async () => {
      const nb = await createNotebook(db, 'Work');
      await markNotebookClean(db, nb.id);
      const [clean] = await getNotebooks(db);
      expect(clean.isDirty).toBe(0);

      await updateNotebook(db, nb.id, 'Renamed');
      const [updated] = await getNotebooks(db);
      expect(updated.isDirty).toBe(1);
    });

    it('getDirtyNotebooks returns only dirty rows', async () => {
      const nb1 = await createNotebook(db, 'A');
      const nb2 = await createNotebook(db, 'B');
      await markNotebookClean(db, nb1.id);

      const dirty = await getDirtyNotebooks(db);
      expect(dirty).toHaveLength(1);
      expect(dirty[0].id).toBe(nb2.id);
    });

    it('markNotebookClean clears dirty and sets synced_at', async () => {
      const nb = await createNotebook(db, 'Work');
      vi.setSystemTime(new Date('2024-06-01'));
      await markNotebookClean(db, nb.id);

      const [cleaned] = await getNotebooks(db);
      expect(cleaned.isDirty).toBe(0);
      expect(cleaned.syncedAt).toBe(new Date('2024-06-01').getTime());
    });

    it('applyRemoteNotebook inserts a new remote notebook', async () => {
      const now = Date.now();
      await applyRemoteNotebook(db, {
        id: 'remote-nb-1',
        name: 'From Remote',
        created_at: now,
        updated_at: now,
      });

      const all = await getNotebooks(db);
      const remote = all.find((n) => n.id === 'remote-nb-1');
      expect(remote).not.toBeUndefined();
      expect(remote!.name).toBe('From Remote');
      expect(remote!.isDirty).toBe(0);
    });

    it('applyRemoteNotebook remote newer wins', async () => {
      const nb = await createNotebook(db, 'Local');
      vi.setSystemTime(new Date('2025-01-01'));

      await applyRemoteNotebook(db, {
        id: nb.id,
        name: 'Remote Name',
        created_at: nb.createdAt,
        updated_at: new Date('2025-01-01').getTime(),
      });

      const all = await getNotebooks(db);
      const updated = all.find((n) => n.id === nb.id);
      expect(updated!.name).toBe('Remote Name');
      expect(updated!.isDirty).toBe(0);
    });

    it('applyRemoteNotebook local newer preserved', async () => {
      const nb = await createNotebook(db, 'Local');
      vi.setSystemTime(new Date('2025-01-01'));
      await updateNotebook(db, nb.id, 'Updated Local');

      await applyRemoteNotebook(db, {
        id: nb.id,
        name: 'Old Remote',
        created_at: nb.createdAt,
        updated_at: new Date('2024-06-01').getTime(),
      });

      const all = await getNotebooks(db);
      const kept = all.find((n) => n.id === nb.id);
      expect(kept!.name).toBe('Updated Local');
      expect(kept!.isDirty).toBe(1);
    });
  });
});
