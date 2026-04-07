import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import type { SyncState, SyncResult } from '@graphite/sync';
import { SyncEngine } from '@graphite/sync';
import { getDatabase } from '@graphite/db';
import {
  getDirtyNotes,
  markNoteClean,
  applyRemoteNote,
  deleteNote,
} from '@graphite/db';
import {
  getDirtyNotebooks,
  markNotebookClean,
  applyRemoteNotebook,
  deleteNotebook,
} from '@graphite/db';
import {
  getDirtyFolders,
  markFolderClean,
  applyRemoteFolder,
  deleteFolder,
} from '@graphite/db';

export interface UseSyncEngineResult {
  syncState: SyncState;
  /** Trigger an immediate push of dirty records. */
  pushNow: () => void;
}

/**
 * Manages the sync lifecycle: pushes dirty records on app foreground and
 * applies remote changes from Supabase Realtime. The engine is only
 * instantiated when a valid userId is provided (i.e., user is logged in
 * and has an active Pro subscription).
 *
 * Phase 2 — the SyncEngine.start/push/pull methods currently throw
 * NotImplementedError. This hook wires the plumbing so that when those
 * stubs are replaced with real Supabase calls, everything flows.
 */
export function useSyncEngine(
  userId: string | null,
  supabaseUrl: string,
  supabaseKey: string,
): UseSyncEngineResult {
  const engineRef = useRef<SyncEngine | null>(null);
  const [syncState, setSyncState] = useState<SyncState>('disabled');

  const pushDirty = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || engine.state === 'disabled') return;

    try {
      const db = getDatabase();

      // Collect dirty records from all three tables.
      let dirtyNotes = await getDirtyNotes(db);
      let dirtyNotebooks = await getDirtyNotebooks(db);
      let dirtyFolders = await getDirtyFolders(db);

      // Web/Electron fallback: noopDb returns empty for everything, but
      // the Zustand stores hold the real in-memory data. Push all store
      // records that haven't been synced yet (syncedAt is null).
      if (dirtyNotes.length === 0 && dirtyNotebooks.length === 0 && dirtyFolders.length === 0) {
        const { useNoteStore } = await import('../stores/use-note-store');
        const { useNotebookStore } = await import('../stores/use-notebook-store');
        const { useFolderStore } = await import('../stores/use-folder-store');
        const storeNotes = useNoteStore.getState().notes;
        const storeNotebooks = useNotebookStore.getState().notebooks;
        const storeFolders = useFolderStore.getState().folders;
        if (storeNotes.length > 0 || storeNotebooks.length > 0 || storeFolders.length > 0) {
          dirtyNotes = storeNotes;
          dirtyNotebooks = storeNotebooks;
          dirtyFolders = storeFolders;
        }
      }

      const records = [
        ...dirtyNotebooks.map((nb) => ({
          id: nb.id,
          table: 'notebooks' as const,
          updatedAt: nb.updatedAt,
          data: {
            id: nb.id,
            name: nb.name,
            sort_order: nb.sortOrder,
            created_at: nb.createdAt,
            updated_at: nb.updatedAt,
          },
        })),
        ...dirtyFolders.map((f) => ({
          id: f.id,
          table: 'folders' as const,
          updatedAt: f.updatedAt,
          data: {
            id: f.id,
            notebook_id: f.notebookId,
            parent_id: f.parentId,
            name: f.name,
            sort_order: f.sortOrder,
            created_at: f.createdAt,
            updated_at: f.updatedAt,
          },
        })),
        ...dirtyNotes.map((n) => ({
          id: n.id,
          table: 'notes' as const,
          updatedAt: n.updatedAt,
          data: {
            id: n.id,
            notebook_id: n.notebookId,
            folder_id: n.folderId,
            title: n.title,
            body: n.body,
            canvas_json: n.canvasJson,
            sort_order: n.sortOrder,
            created_at: n.createdAt,
            updated_at: n.updatedAt,
          },
        })),
      ];

      if (records.length === 0) return;

      setSyncState('syncing');
      const result: SyncResult = await engine.push(records);

      // Mark successfully pushed records as clean.
      const errorIds = new Set(result.errors.map((e) => e.record));

      for (const nb of dirtyNotebooks) {
        if (!errorIds.has(nb.id)) await markNotebookClean(db, nb.id);
      }
      for (const f of dirtyFolders) {
        if (!errorIds.has(f.id)) await markFolderClean(db, f.id);
      }
      for (const n of dirtyNotes) {
        if (!errorIds.has(n.id)) await markNoteClean(db, n.id);
      }

      setSyncState(result.errors.length > 0 ? 'error' : 'idle');
    } catch (_) {
      setSyncState('error');
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      setSyncState('disabled');
      return;
    }

    let engine: SyncEngine;
    try {
      engine = new SyncEngine({
        supabaseUrl,
        supabaseAnonKey: supabaseKey,
        userId,
      });
    } catch (_) {
      setSyncState('error');
      return;
    }

    engineRef.current = engine;

    // Attempt to start the engine. In Phase 2 this will connect to
    // Supabase Realtime. The current scaffold throws NotImplementedError,
    // so we catch and set state to offline.
    engine
      .start()
      .then(() => setSyncState(engine.state))
      .catch(() => setSyncState('offline'));

    // Push dirty records when the app comes to the foreground.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void pushDirty();
    });

    // Also push periodically (every 5 seconds) to catch changes made
    // during the current session. On web/Electron where AppState doesn't
    // fire reliably, this is the primary push mechanism.
    const interval = setInterval(() => {
      void pushDirty();
    }, 5000);

    // Initial push on startup
    void pushDirty();

    return () => {
      clearInterval(interval);
      subscription.remove();
      engine
        .stop()
        .catch(() => {
          // Best-effort cleanup.
        });
      engineRef.current = null;
    };
  }, [userId, supabaseUrl, supabaseKey, pushDirty]);

  const triggerPush = useCallback(() => {
    void pushDirty();
  }, [pushDirty]);

  return { syncState, pushNow: triggerPush };
}
