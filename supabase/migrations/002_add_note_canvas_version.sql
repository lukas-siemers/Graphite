-- 002_add_note_canvas_version.sql
-- Add canvas_version column to public.notes to match local SQLite migration 8.
--
-- Context: the local SQLite schema adds canvas_version INTEGER DEFAULT 1
-- (ALL_MIGRATIONS entry in packages/db/src/schema.ts). The sync engine push
-- payload for notes (apps/mobile/hooks/use-sync-engine.ts) includes
-- canvas_version, but the Supabase notes table was never migrated, so every
-- note upsert was silently rejected with "column canvas_version does not
-- exist". Folders and notebooks carry no extra columns and synced fine,
-- which is why the regression only hit notes.
--
-- graphite_blob content is handled separately: extractSpatialBlob() in
-- packages/sync/src/engine.ts strips the blob from the row before upsert
-- and uploads it to Supabase Storage via uploadGraphiteBlob(). So no
-- graphite_blob or fts_body column is needed on notes for sync to work.

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS canvas_version INTEGER DEFAULT 1;
