import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadGraphiteBlob, downloadGraphiteBlob, deleteGraphiteBlob } from '../storage';

type StorageMock = {
  upload: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
};

function makeSupabaseMock(overrides: Partial<{
  uploadResult: { data: unknown; error: unknown };
  downloadResult: { data: unknown; error: unknown };
  removeResult: { data: unknown; error: unknown };
}> = {}): { supabase: { storage: { from: StorageMock['from'] } }; storage: StorageMock } {
  const storage: StorageMock = {
    upload: vi.fn().mockResolvedValue(
      overrides.uploadResult ?? { data: { path: 'u/n.graphite' }, error: null },
    ),
    download: vi.fn().mockResolvedValue(
      overrides.downloadResult ?? { data: new Blob([new Uint8Array([1, 2, 3])]), error: null },
    ),
    remove: vi.fn().mockResolvedValue(
      overrides.removeResult ?? { data: [{ name: 'u/n.graphite' }], error: null },
    ),
    from: vi.fn(),
  };
  storage.from.mockReturnValue({
    upload: storage.upload,
    download: storage.download,
    remove: storage.remove,
  });
  return {
    supabase: { storage: { from: storage.from } },
    storage,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('uploadGraphiteBlob', () => {
  it('uploads to the correct path with upsert: true', async () => {
    const { supabase, storage } = makeSupabaseMock();
    const blob = new Uint8Array([10, 20, 30]);

    const path = await uploadGraphiteBlob(
      supabase as never,
      'user-1',
      'note-1',
      blob,
    );

    expect(path).toBe('user-1/note-1.graphite');
    expect(storage.from).toHaveBeenCalledWith('graphite-notes');
    expect(storage.upload).toHaveBeenCalledTimes(1);
    const [calledPath, calledBytes, opts] = storage.upload.mock.calls[0];
    expect(calledPath).toBe('user-1/note-1.graphite');
    expect(calledBytes).toBe(blob);
    expect(opts).toMatchObject({ upsert: true, contentType: 'application/zip' });
  });

  it('throws on upload error', async () => {
    const { supabase } = makeSupabaseMock({
      uploadResult: { data: null, error: new Error('storage exploded') },
    });

    await expect(
      uploadGraphiteBlob(supabase as never, 'u', 'n', new Uint8Array([1])),
    ).rejects.toThrow('storage exploded');
  });
});

describe('downloadGraphiteBlob', () => {
  it('returns bytes matching the uploaded payload', async () => {
    const original = new Uint8Array([99, 100, 101, 102]);
    const { supabase, storage } = makeSupabaseMock({
      downloadResult: { data: new Blob([original]), error: null },
    });

    const got = await downloadGraphiteBlob(supabase as never, 'user-1', 'note-1');

    expect(storage.from).toHaveBeenCalledWith('graphite-notes');
    expect(storage.download).toHaveBeenCalledWith('user-1/note-1.graphite');
    expect(got).toBeInstanceOf(Uint8Array);
    expect(Array.from(got ?? [])).toEqual(Array.from(original));
  });

  it('returns null on 404', async () => {
    const { supabase } = makeSupabaseMock({
      downloadResult: { data: null, error: { statusCode: '404', message: 'Not found' } },
    });

    const got = await downloadGraphiteBlob(supabase as never, 'u', 'missing');
    expect(got).toBeNull();
  });

  it('returns null on numeric 404 status', async () => {
    const { supabase } = makeSupabaseMock({
      downloadResult: { data: null, error: { status: 404, message: 'Not found' } },
    });

    const got = await downloadGraphiteBlob(supabase as never, 'u', 'missing');
    expect(got).toBeNull();
  });

  it('throws on non-404 errors', async () => {
    const { supabase } = makeSupabaseMock({
      downloadResult: { data: null, error: { statusCode: '500', message: 'boom' } },
    });

    await expect(
      downloadGraphiteBlob(supabase as never, 'u', 'n'),
    ).rejects.toMatchObject({ statusCode: '500' });
  });

  it('returns null when data is null with no error', async () => {
    const { supabase } = makeSupabaseMock({
      downloadResult: { data: null, error: null },
    });

    const got = await downloadGraphiteBlob(supabase as never, 'u', 'n');
    expect(got).toBeNull();
  });
});

describe('deleteGraphiteBlob', () => {
  it('removes the correct path', async () => {
    const { supabase, storage } = makeSupabaseMock();

    await deleteGraphiteBlob(supabase as never, 'user-1', 'note-1');

    expect(storage.from).toHaveBeenCalledWith('graphite-notes');
    expect(storage.remove).toHaveBeenCalledWith(['user-1/note-1.graphite']);
  });

  it('swallows 404 errors', async () => {
    const { supabase } = makeSupabaseMock({
      removeResult: { data: null, error: { statusCode: '404', message: 'Not found' } },
    });

    await expect(
      deleteGraphiteBlob(supabase as never, 'u', 'gone'),
    ).resolves.toBeUndefined();
  });

  it('throws on non-404 errors', async () => {
    const { supabase } = makeSupabaseMock({
      removeResult: { data: null, error: { statusCode: '403', message: 'forbidden' } },
    });

    await expect(
      deleteGraphiteBlob(supabase as never, 'u', 'n'),
    ).rejects.toMatchObject({ statusCode: '403' });
  });
});
