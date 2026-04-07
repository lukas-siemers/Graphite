-- 001_initial_schema.sql
-- Supabase Postgres schema matching local SQLite schema.
-- Every table includes user_id for RLS enforcement.
-- Timestamps are BIGINT (Unix ms) to match SQLite conventions.

-- Enable UUID extension (usually pre-enabled on Supabase)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Tables
-- ============================================================

CREATE TABLE public.notebooks (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  synced_at BIGINT
);

CREATE TABLE public.folders (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  notebook_id TEXT NOT NULL REFERENCES public.notebooks(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES public.folders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE public.notes (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES public.folders(id) ON DELETE SET NULL,
  notebook_id TEXT NOT NULL REFERENCES public.notebooks(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled',
  body TEXT NOT NULL DEFAULT '',
  canvas_json TEXT,
  is_dirty INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  synced_at BIGINT
);

CREATE TABLE public.tags (
  id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE(user_id, name)
);

CREATE TABLE public.note_tags (
  note_id TEXT NOT NULL REFERENCES public.notes(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE public.settings (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- ============================================================
-- Indexes for common query patterns
-- ============================================================

CREATE INDEX idx_notebooks_user ON public.notebooks(user_id);
CREATE INDEX idx_folders_user ON public.folders(user_id);
CREATE INDEX idx_folders_notebook ON public.folders(notebook_id);
CREATE INDEX idx_notes_user ON public.notes(user_id);
CREATE INDEX idx_notes_notebook ON public.notes(notebook_id);
CREATE INDEX idx_notes_folder ON public.notes(folder_id);
CREATE INDEX idx_notes_updated ON public.notes(user_id, updated_at);
CREATE INDEX idx_tags_user ON public.tags(user_id);

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE public.notebooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD their own notebooks"
  ON public.notebooks FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can CRUD their own folders"
  ON public.folders FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can CRUD their own notes"
  ON public.notes FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can CRUD their own tags"
  ON public.tags FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can CRUD their own note_tags"
  ON public.note_tags FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.notes
      WHERE notes.id = note_tags.note_id
        AND notes.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.notes
      WHERE notes.id = note_tags.note_id
        AND notes.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can CRUD their own settings"
  ON public.settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================
-- Realtime — enable change feeds for sync tables
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.notebooks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.folders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notes;
