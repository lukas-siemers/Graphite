import type { SQLiteDatabase } from 'expo-sqlite';
import { nanoid } from 'nanoid/non-secure';
import type { Note } from '../types';

interface RawNote {
  id: string;
  folder_id: string | null;
  notebook_id: string;
  title: string;
  body: string;
  drawing_asset_id: string | null;
  canvas_json: string | null;
  is_dirty: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
  synced_at: number | null;
}

function mapNote(row: RawNote): Note {
  return {
    id: row.id,
    folderId: row.folder_id,
    notebookId: row.notebook_id,
    title: row.title,
    body: row.body,
    drawingAssetId: row.drawing_asset_id,
    canvasJson: row.canvas_json,
    isDirty: row.is_dirty,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    syncedAt: row.synced_at,
  };
}

export interface Tag {
  id: string;
  name: string;
  createdAt: number;
}

export interface TagWithCount {
  id: string;
  name: string;
  count: number;
}

const TAG_REGEX = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]{0,49})(?=\s|$|[.,;:!?)])/g;

/**
 * Strip fenced code blocks (``` ... ```) from text before tag extraction.
 */
function stripCodeFences(text: string): string {
  return text.replace(/^```[^\n]*\n[\s\S]*?^```/gm, '');
}

/**
 * Pure function — extracts lowercase tag names from a note body string.
 * Skips tags inside fenced code blocks.
 */
export function extractTags(body: string): string[] {
  const stripped = stripCodeFences(body);
  const tags: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  // Reset lastIndex before iterating
  TAG_REGEX.lastIndex = 0;
  while ((match = TAG_REGEX.exec(stripped)) !== null) {
    const name = match[1].toLowerCase();
    if (!seen.has(name)) {
      seen.add(name);
      tags.push(name);
    }
  }
  return tags;
}

/**
 * Sync the note_tags join table for a given note.
 * Creates new tag rows for first-seen names, deletes removed links,
 * and garbage-collects orphaned tags (0 remaining note_tags rows).
 */
export async function syncNoteTags(
  db: SQLiteDatabase,
  noteId: string,
  tagNames: string[],
): Promise<void> {
  // Current tags linked to this note
  const currentRows = await db.getAllAsync<{ tag_id: string; name: string }>(
    `SELECT t.id AS tag_id, t.name FROM tags t
     JOIN note_tags nt ON nt.tag_id = t.id
     WHERE nt.note_id = ?`,
    [noteId],
  );

  const currentMap = new Map(currentRows.map((r: { tag_id: string; name: string }) => [r.name, r.tag_id]));
  const desiredSet = new Set(tagNames);

  // Tags to remove
  const toRemove = currentRows.filter((r: { tag_id: string; name: string }) => !desiredSet.has(r.name));
  // Tags to add
  const toAdd = tagNames.filter((name) => !currentMap.has(name));

  // Delete removed links
  for (const row of toRemove) {
    await db.runAsync(
      'DELETE FROM note_tags WHERE note_id = ? AND tag_id = ?',
      [noteId, row.tag_id],
    );
  }

  // Insert new links (create tag row if needed)
  for (const name of toAdd) {
    let tagRow = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM tags WHERE name = ?',
      [name],
    );
    if (!tagRow) {
      const tagId = nanoid();
      const now = Date.now();
      await db.runAsync(
        'INSERT INTO tags (id, name, created_at) VALUES (?, ?, ?)',
        [tagId, name, now],
      );
      tagRow = { id: tagId };
    }
    await db.runAsync(
      'INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)',
      [noteId, tagRow.id],
    );
  }

  // Garbage-collect orphaned tags from removed links
  for (const row of toRemove) {
    const countRow = await db.getFirstAsync<{ cnt: number }>(
      'SELECT COUNT(*) AS cnt FROM note_tags WHERE tag_id = ?',
      [row.tag_id],
    );
    if (countRow && countRow.cnt === 0) {
      await db.runAsync('DELETE FROM tags WHERE id = ?', [row.tag_id]);
    }
  }
}

/**
 * Returns all tags with their note count, sorted alphabetically.
 */
export async function getAllTags(
  db: SQLiteDatabase,
): Promise<TagWithCount[]> {
  const rows = await db.getAllAsync<{ id: string; name: string; count: number }>(
    `SELECT t.id, t.name, COUNT(nt.note_id) AS count
     FROM tags t
     JOIN note_tags nt ON nt.tag_id = t.id
     GROUP BY t.id, t.name
     ORDER BY t.name ASC`,
  );
  return rows;
}

/**
 * Returns all notes that have a given tag name.
 */
export async function getNotesForTag(
  db: SQLiteDatabase,
  tagName: string,
): Promise<Note[]> {
  const rows = await db.getAllAsync<RawNote>(
    `SELECT n.* FROM notes n
     JOIN note_tags nt ON nt.note_id = n.id
     JOIN tags t ON t.id = nt.tag_id
     WHERE t.name = ?
     ORDER BY n.updated_at DESC`,
    [tagName.toLowerCase()],
  );
  return rows.map(mapNote);
}
