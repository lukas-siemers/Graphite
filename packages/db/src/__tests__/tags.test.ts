import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createExpoCompatibleDb } from '../test-utils';
import { createNotebook } from '../operations/notebooks';
import { createNote, updateNote } from '../operations/notes';
import {
  extractTags,
  syncNoteTags,
  getAllTags,
  getNotesForTag,
} from '../operations/tags';

describe('extractTags', () => {
  it('extracts simple tags from text', () => {
    expect(extractTags('hello #world #foo')).toEqual(['world', 'foo']);
  });

  it('rejects tags starting with a number', () => {
    expect(extractTags('#123 not a tag')).toEqual([]);
  });

  it('lowercases CamelCase tags', () => {
    expect(extractTags('#CamelCase')).toEqual(['camelcase']);
  });

  it('excludes tags inside fenced code blocks', () => {
    const body = 'text\n```\n#excluded\n```\n#included';
    expect(extractTags(body)).toEqual(['included']);
  });

  it('handles tags at start of line', () => {
    expect(extractTags('#start of line')).toEqual(['start']);
  });

  it('handles tags followed by punctuation', () => {
    expect(extractTags('see #tag, and #other.')).toEqual(['tag', 'other']);
  });

  it('deduplicates repeated tags', () => {
    expect(extractTags('#foo #bar #foo')).toEqual(['foo', 'bar']);
  });

  it('rejects tags longer than 50 chars', () => {
    const longTag = '#' + 'a'.repeat(51);
    expect(extractTags(longTag)).toEqual([]);
  });

  it('accepts tags with hyphens and underscores', () => {
    expect(extractTags('#my-tag #my_tag')).toEqual(['my-tag', 'my_tag']);
  });

  it('handles multiple code fences', () => {
    const body = '#before\n```js\n#inside1\n```\n#middle\n```\n#inside2\n```\n#after';
    expect(extractTags(body)).toEqual(['before', 'middle', 'after']);
  });
});

describe('tag DB operations', () => {
  let db: ReturnType<typeof createExpoCompatibleDb>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01'));
    db = createExpoCompatibleDb();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('syncNoteTags creates new tags and links them', async () => {
    const nb = await createNotebook(db, 'Work');
    const note = await createNote(db, nb.id);

    await syncNoteTags(db, note.id, ['javascript', 'react']);

    const tags = await getAllTags(db);
    expect(tags).toHaveLength(2);
    expect(tags.map((t) => t.name).sort()).toEqual(['javascript', 'react']);
    expect(tags.every((t) => t.count === 1)).toBe(true);
  });

  it('syncNoteTags removes unlinked tags and garbage-collects orphans', async () => {
    const nb = await createNotebook(db, 'Work');
    const note = await createNote(db, nb.id);

    await syncNoteTags(db, note.id, ['alpha', 'beta']);
    // Remove alpha, keep beta
    await syncNoteTags(db, note.id, ['beta']);

    const tags = await getAllTags(db);
    expect(tags).toHaveLength(1);
    expect(tags[0].name).toBe('beta');
  });

  it('syncNoteTags does not garbage-collect tags still used by other notes', async () => {
    const nb = await createNotebook(db, 'Work');
    const note1 = await createNote(db, nb.id);
    const note2 = await createNote(db, nb.id);

    await syncNoteTags(db, note1.id, ['shared', 'only1']);
    await syncNoteTags(db, note2.id, ['shared', 'only2']);

    // Remove shared from note1
    await syncNoteTags(db, note1.id, ['only1']);

    const tags = await getAllTags(db);
    const tagNames = tags.map((t) => t.name).sort();
    expect(tagNames).toEqual(['only1', 'only2', 'shared']);
    // shared should now have count 1
    expect(tags.find((t) => t.name === 'shared')!.count).toBe(1);
  });

  it('getAllTags returns correct counts', async () => {
    const nb = await createNotebook(db, 'Work');
    const n1 = await createNote(db, nb.id);
    const n2 = await createNote(db, nb.id);
    const n3 = await createNote(db, nb.id);

    await syncNoteTags(db, n1.id, ['common', 'rare']);
    await syncNoteTags(db, n2.id, ['common']);
    await syncNoteTags(db, n3.id, ['common']);

    const tags = await getAllTags(db);
    expect(tags.find((t) => t.name === 'common')!.count).toBe(3);
    expect(tags.find((t) => t.name === 'rare')!.count).toBe(1);
  });

  it('getNotesForTag returns matching notes', async () => {
    const nb = await createNotebook(db, 'Work');
    const n1 = await createNote(db, nb.id);
    const n2 = await createNote(db, nb.id);
    const n3 = await createNote(db, nb.id);

    await updateNote(db, n1.id, { title: 'Note 1' });
    await updateNote(db, n2.id, { title: 'Note 2' });
    await updateNote(db, n3.id, { title: 'Note 3' });

    await syncNoteTags(db, n1.id, ['target']);
    await syncNoteTags(db, n2.id, ['target']);
    await syncNoteTags(db, n3.id, ['other']);

    const result = await getNotesForTag(db, 'target');
    expect(result).toHaveLength(2);
    const titles = result.map((n) => n.title).sort();
    expect(titles).toEqual(['Note 1', 'Note 2']);
  });

  it('getNotesForTag is case-insensitive', async () => {
    const nb = await createNotebook(db, 'Work');
    const note = await createNote(db, nb.id);

    await syncNoteTags(db, note.id, ['mytag']);

    const result = await getNotesForTag(db, 'MyTag');
    expect(result).toHaveLength(1);
  });

  it('syncNoteTags with empty array clears all tags for a note', async () => {
    const nb = await createNotebook(db, 'Work');
    const note = await createNote(db, nb.id);

    await syncNoteTags(db, note.id, ['a', 'b', 'c']);
    await syncNoteTags(db, note.id, []);

    const tags = await getAllTags(db);
    expect(tags).toHaveLength(0);
  });
});
