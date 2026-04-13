import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine } from '../engine';
import { resetSupabaseClient } from '../client';

const baseConfig = {
  supabaseUrl: 'https://stub.example',
  supabaseAnonKey: 'stub-key',
  userId: 'user-1',
};

const upsertMock = vi.fn();
const uploadMock = vi.fn();
const downloadMock = vi.fn();
const removeMock = vi.fn();
const fromMock = vi.fn();
// Per-table script for pull(): maps table name -> array of row objects.
const tableData: Record<string, Array<Record<string, unknown>>> = {};

vi.mock('@supabase/supabase-js', () => {
  const storageBucket = {
    upload: (...args: unknown[]) => uploadMock(...args),
    download: (...args: unknown[]) => downloadMock(...args),
    remove: (...args: unknown[]) => removeMock(...args),
  };
  const channel = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  };

  function makeBuilder(table: string) {
    const builder = {
      upsert: (...args: unknown[]) => upsertMock(table, ...args),
      select: () => builder,
      eq: () => builder,
      gt: () => Promise.resolve({ data: tableData[table] ?? [], error: null }),
    };
    return builder;
  }

  const client = {
    from: (table: string) => {
      fromMock(table);
      return makeBuilder(table);
    },
    channel: vi.fn().mockReturnValue(channel),
    removeChannel: vi.fn().mockResolvedValue(undefined),
    storage: {
      from: vi.fn().mockReturnValue(storageBucket),
    },
  };
  return { createClient: vi.fn().mockReturnValue(client) };
});

beforeEach(() => {
  resetSupabaseClient();
  upsertMock.mockReset();
  uploadMock.mockReset();
  downloadMock.mockReset();
  removeMock.mockReset();
  fromMock.mockReset();
  for (const k of Object.keys(tableData)) delete tableData[k];

  upsertMock.mockResolvedValue({ data: null, error: null });
  uploadMock.mockResolvedValue({ data: { path: 'ok' }, error: null });
  downloadMock.mockResolvedValue({
    data: new Blob([new Uint8Array([7, 8, 9])]),
    error: null,
  });
  removeMock.mockResolvedValue({ data: [], error: null });
});

describe('SyncEngine blob wiring — push', () => {
  it('uploads the graphite blob and strips it from the upserted row for v2 notes', async () => {
    const engine = new SyncEngine(baseConfig);
    const blob = new Uint8Array([1, 2, 3, 4]);

    const result = await engine.push([
      {
        id: 'note-1',
        table: 'notes',
        updatedAt: 1000,
        data: {
          id: 'note-1',
          title: 'Spatial',
          canvas_version: 2,
          graphite_blob: blob,
          fts_body: 'Spatial hello',
          updated_at: 1000,
        },
      },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.pushed).toBe(1);

    expect(uploadMock).toHaveBeenCalledTimes(1);
    const [path, bytes, opts] = uploadMock.mock.calls[0];
    expect(path).toBe('user-1/note-1.graphite');
    expect(bytes).toBe(blob);
    expect(opts).toMatchObject({ upsert: true });

    expect(upsertMock).toHaveBeenCalledTimes(1);
    const [table, upsertedRow] = upsertMock.mock.calls[0];
    expect(table).toBe('notes');
    expect(upsertedRow.graphite_blob).toBeUndefined();
    expect(upsertedRow.canvas_version).toBe(2);
    expect(upsertedRow.fts_body).toBe('Spatial hello');
    expect(upsertedRow.user_id).toBe('user-1');
  });

  it('does not call upload for v1 notes', async () => {
    const engine = new SyncEngine(baseConfig);

    await engine.push([
      {
        id: 'note-2',
        table: 'notes',
        updatedAt: 2000,
        data: {
          id: 'note-2',
          title: 'Legacy',
          canvas_version: 1,
          body: 'legacy body',
          updated_at: 2000,
        },
      },
    ]);

    expect(uploadMock).not.toHaveBeenCalled();
    expect(upsertMock).toHaveBeenCalledTimes(1);
  });

  it('does not call upload for notebooks or folders', async () => {
    const engine = new SyncEngine(baseConfig);

    await engine.push([
      {
        id: 'nb-1',
        table: 'notebooks',
        updatedAt: 1,
        data: { id: 'nb-1', name: 'x', canvas_version: 2, graphite_blob: new Uint8Array([9]) },
      },
    ]);

    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('reports upload failure as a record error and skips upsert', async () => {
    uploadMock.mockResolvedValueOnce({ data: null, error: new Error('upload failed') });
    const engine = new SyncEngine(baseConfig);

    const result = await engine.push([
      {
        id: 'note-3',
        table: 'notes',
        updatedAt: 3000,
        data: {
          id: 'note-3',
          canvas_version: 2,
          graphite_blob: new Uint8Array([1]),
          updated_at: 3000,
        },
      },
    ]);

    expect(result.pushed).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ record: 'note-3' });
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe('SyncEngine blob wiring — pull', () => {
  it('downloads the graphite blob for v2 notes and enriches the row', async () => {
    const payload = new Uint8Array([42, 43, 44]);
    tableData.notes = [{ id: 'note-9', canvas_version: 2, updated_at: 5000 }];
    downloadMock.mockResolvedValueOnce({ data: new Blob([payload]), error: null });

    const engine = new SyncEngine(baseConfig);
    const seen: Array<{ row: Record<string, unknown> | null }> = [];
    engine.onRemoteChange = (_t, _e, newRow) => {
      seen.push({ row: newRow });
    };

    await engine.pull(0);

    expect(downloadMock).toHaveBeenCalledWith('user-1/note-9.graphite');
    expect(seen.length).toBeGreaterThan(0);
    const row = seen[0].row as Record<string, unknown>;
    expect(row.id).toBe('note-9');
    expect(row.graphite_blob).toBeInstanceOf(Uint8Array);
    expect(Array.from(row.graphite_blob as Uint8Array)).toEqual(Array.from(payload));
  });

  it('does not download for v1 notes', async () => {
    tableData.notes = [{ id: 'note-v1', canvas_version: 1, updated_at: 1000 }];

    const engine = new SyncEngine(baseConfig);
    const seen: Array<Record<string, unknown> | null> = [];
    engine.onRemoteChange = (_t, _e, row) => seen.push(row);

    await engine.pull(0);

    expect(downloadMock).not.toHaveBeenCalled();
    // Row passes through without graphite_blob
    const noteRow = seen.find((r) => r && r.id === 'note-v1');
    expect(noteRow?.graphite_blob).toBeUndefined();
  });

  it('surfaces row without blob when download fails', async () => {
    tableData.notes = [{ id: 'note-x', canvas_version: 2, updated_at: 1000 }];
    downloadMock.mockResolvedValue({
      data: null,
      error: { statusCode: '500', message: 'server error' },
    });

    const engine = new SyncEngine(baseConfig);
    const seen: Array<Record<string, unknown> | null> = [];
    engine.onRemoteChange = (_t, _e, row) => seen.push(row);

    await engine.pull(0);

    const noteRow = seen.find((r) => r && r.id === 'note-x');
    expect(noteRow).toBeDefined();
    expect(noteRow?.graphite_blob).toBeUndefined();
  });
});
