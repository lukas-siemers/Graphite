/**
 * Pure remote-row → Zustand-store adapter for the web/Electron sync path.
 *
 * Extracted from `use-sync-engine.ts` so the adapter can be unit-tested in
 * Node without pulling in `react-native` (whose `AppState` import brings
 * the whole native shim tree into the Vitest resolver).
 *
 * On the Electron renderer (and Expo web) the local DB is the `noopDb`
 * stub in `packages/db/src/migrations.ts` — `applyRemoteNote(noopDb, row)`
 * writes to nothing, and a follow-up `getNotes(noopDb, ...)` returns `[]`.
 * Following the mobile "write-then-reload-from-DB" pattern on desktop
 * would wipe the stores on every remote event. Instead we detect the
 * noopDb context in the hook and call this adapter, which applies rows
 * straight to the in-memory Zustand stores. iPad/native still takes the
 * SQLite round-trip so FTS + dirty tracking stay correct there.
 *
 * The adapter is intentionally dependency-free: it takes the three store
 * singletons as parameters (so callers can mock them in tests) and never
 * imports the store modules itself.
 */

type RemoteRow = Record<string, unknown>;

export function mapRemoteNote(row: RemoteRow) {
  return {
    id: String(row.id),
    folderId: (row.folder_id as string | null) ?? null,
    notebookId: String(row.notebook_id),
    title: (row.title as string) ?? 'Untitled',
    body: (row.body as string) ?? '',
    drawingAssetId: (row.drawing_asset_id as string | null) ?? null,
    canvasJson: (row.canvas_json as string | null) ?? null,
    // Remote rows should never land dirty on the local device — they
    // were written by another device and synced down.
    isDirty: 0,
    sortOrder: (row.sort_order as number) ?? 0,
    createdAt: Number(row.created_at ?? Date.now()),
    updatedAt: Number(row.updated_at ?? Date.now()),
    syncedAt: Date.now(),
  };
}

export function mapRemoteNotebook(row: RemoteRow) {
  return {
    id: String(row.id),
    name: (row.name as string) ?? 'Untitled',
    isDirty: 0,
    sortOrder: (row.sort_order as number) ?? 0,
    createdAt: Number(row.created_at ?? Date.now()),
    updatedAt: Number(row.updated_at ?? Date.now()),
    syncedAt: Date.now(),
  };
}

export function mapRemoteFolder(row: RemoteRow) {
  return {
    id: String(row.id),
    notebookId: String(row.notebook_id),
    parentId: (row.parent_id as string | null) ?? null,
    name: (row.name as string) ?? 'Untitled',
    isDirty: 0,
    sortOrder: (row.sort_order as number) ?? 0,
    createdAt: Number(row.created_at ?? Date.now()),
    updatedAt: Number(row.updated_at ?? Date.now()),
    syncedAt: Date.now(),
  };
}

/**
 * Merge a single remote row into the Zustand stores.
 *
 * Contract:
 *   - DELETE events remove the row by id from the appropriate store and
 *     clear `activeNotebookId` if the active notebook got deleted.
 *   - INSERT/UPDATE events upsert by id: replace-in-place if present,
 *     append otherwise. Notes also populate `activeNoteId` the first time
 *     any note lands so the user doesn't see an empty editor.
 *   - All remote rows are marked `isDirty = 0` and `syncedAt = now` to
 *     match what `applyRemoteNote` (mobile SQLite path) would do.
 *   - Unknown / null `newRecord` is ignored (defensive — Realtime
 *     occasionally emits partial payloads).
 */
export function applyRemoteToStore(
  table: 'notebooks' | 'folders' | 'notes',
  event: 'INSERT' | 'UPDATE' | 'DELETE',
  newRecord: RemoteRow | null,
  useNotebookStore: any,
  useFolderStore: any,
  useNoteStore: any,
): void {
  if (event === 'DELETE') {
    const id = (newRecord as RemoteRow | null)?.id as string | undefined;
    if (!id) return;
    if (table === 'notes') {
      useNoteStore.getState().removeNote(id);
    } else if (table === 'folders') {
      useFolderStore.setState((s: { folders: Array<{ id: string }> }) => ({
        folders: s.folders.filter((f) => f.id !== id),
      }));
    } else if (table === 'notebooks') {
      useNotebookStore.setState(
        (s: { notebooks: Array<{ id: string }>; activeNotebookId: string | null }) => ({
          notebooks: s.notebooks.filter((n) => n.id !== id),
          activeNotebookId: s.activeNotebookId === id ? null : s.activeNotebookId,
        }),
      );
    }
    return;
  }

  if (!newRecord) return;

  if (table === 'notes') {
    const note = mapRemoteNote(newRecord);
    const state = useNoteStore.getState();
    const existing = state.notes.findIndex((n: { id: string }) => n.id === note.id);
    if (existing >= 0) {
      state.updateNote(note.id, note);
    } else {
      state.addNote(note);
    }
    // First time we see any notes on desktop, surface one so the user
    // isn't staring at an empty editor.
    if (!state.activeNoteId) {
      useNoteStore.getState().setActiveNote(note.id);
    }
  } else if (table === 'notebooks') {
    const nb = mapRemoteNotebook(newRecord);
    useNotebookStore.setState(
      (s: { notebooks: Array<{ id: string }>; activeNotebookId: string | null }) => {
        const idx = s.notebooks.findIndex((n) => n.id === nb.id);
        const next = idx >= 0
          ? s.notebooks.map((n) => (n.id === nb.id ? { ...n, ...nb } : n))
          : [...s.notebooks, nb];
        return {
          notebooks: next,
          activeNotebookId: s.activeNotebookId ?? nb.id,
        };
      },
    );
  } else if (table === 'folders') {
    const folder = mapRemoteFolder(newRecord);
    useFolderStore.setState((s: { folders: Array<{ id: string }> }) => {
      const idx = s.folders.findIndex((f) => f.id === folder.id);
      const next = idx >= 0
        ? s.folders.map((f) => (f.id === folder.id ? { ...f, ...folder } : f))
        : [...s.folders, folder];
      return { folders: next };
    });
  }
}

/**
 * Detect the Electron-renderer / Expo-web context where `@graphite/db`
 * returns a noopDb. Same predicate as `packages/db/src/migrations.ts`.
 */
export function isWebNoopDbContext(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}
