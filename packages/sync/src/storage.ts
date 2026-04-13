import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'graphite-notes';

function blobPath(userId: string, noteId: string): string {
  return `${userId}/${noteId}.graphite`;
}

/**
 * Upload a `.graphite` ZIP blob for a note to Supabase Storage.
 * Path: `{userId}/{noteId}.graphite` inside the `graphite-notes` bucket.
 * Uses upsert so re-uploads overwrite the prior version.
 * Returns the storage path on success.
 */
export async function uploadGraphiteBlob(
  supabase: SupabaseClient,
  userId: string,
  noteId: string,
  blob: Uint8Array,
): Promise<string> {
  const path = blobPath(userId, noteId);
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    upsert: true,
    contentType: 'application/zip',
  });
  if (error) throw error;
  return path;
}

/**
 * Download a `.graphite` ZIP blob. Returns null if the object does not exist
 * (404), otherwise throws on unexpected errors.
 */
export async function downloadGraphiteBlob(
  supabase: SupabaseClient,
  userId: string,
  noteId: string,
): Promise<Uint8Array | null> {
  const path = blobPath(userId, noteId);
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) {
    // supabase-js surfaces storage errors as { statusCode, message } or { status }
    const statusCode = (error as { statusCode?: string | number; status?: number }).statusCode;
    const status = (error as { status?: number }).status;
    if (String(statusCode) === '404' || status === 404) {
      return null;
    }
    throw error;
  }
  if (!data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Delete a `.graphite` blob for a note. Used by the delete-note sync path.
 * Does not throw if the object does not exist.
 */
export async function deleteGraphiteBlob(
  supabase: SupabaseClient,
  userId: string,
  noteId: string,
): Promise<void> {
  const path = blobPath(userId, noteId);
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) {
    const statusCode = (error as { statusCode?: string | number; status?: number }).statusCode;
    const status = (error as { status?: number }).status;
    if (String(statusCode) === '404' || status === 404) return;
    throw error;
  }
}
