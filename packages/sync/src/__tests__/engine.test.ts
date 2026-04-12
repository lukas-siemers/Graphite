import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncEngine } from '../engine';
import { resetSupabaseClient } from '../client';

const baseConfig = {
  supabaseUrl: 'https://stub.example',
  supabaseAnonKey: 'stub-key',
  userId: 'user-1',
};

// Mock @supabase/supabase-js so the engine's network calls fail fast and
// deterministically instead of waiting on real DNS/TCP timeouts (which blew
// past the 5s Vitest default on CI — see fix/sync-test-timeout).
vi.mock('@supabase/supabase-js', () => {
  const networkError = new Error('mocked network failure');
  const queryBuilder = {
    upsert: vi.fn().mockResolvedValue({ data: null, error: networkError }),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockResolvedValue({ data: null, error: networkError }),
  };
  const channel = {
    on: vi.fn().mockReturnThis(),
    subscribe: vi.fn().mockReturnThis(),
  };
  const client = {
    from: vi.fn().mockReturnValue(queryBuilder),
    channel: vi.fn().mockReturnValue(channel),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  };
  return {
    createClient: vi.fn().mockReturnValue(client),
  };
});

beforeEach(() => {
  // Reset the singleton so each test picks up a fresh mocked client
  resetSupabaseClient();
});

describe('SyncEngine', () => {
  it('throws when constructed without a userId', () => {
    expect(() => new SyncEngine({ ...baseConfig, userId: '' })).toThrow();
  });

  it('starts in disabled state', () => {
    const engine = new SyncEngine(baseConfig);
    expect(engine.state).toBe('disabled');
  });

  it('push() returns empty result when given no records', async () => {
    const engine = new SyncEngine(baseConfig);
    const result = await engine.push([]);
    expect(result.pushed).toBe(0);
    expect(result.pulled).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('push() handles errors gracefully', async () => {
    const engine = new SyncEngine(baseConfig);
    // Pushing to a non-existent Supabase URL will fail at the network level
    const result = await engine.push([
      {
        id: 'note-1',
        table: 'notes',
        updatedAt: Date.now(),
        data: { id: 'note-1', title: 'Test', body: '', created_at: Date.now(), updated_at: Date.now() },
      },
    ]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.pushed).toBe(0);
  });

  it('stop() sets state to disabled', async () => {
    const engine = new SyncEngine(baseConfig);
    await engine.stop();
    expect(engine.state).toBe('disabled');
  });

  it('onRemoteChange callback can be set and cleared', () => {
    const engine = new SyncEngine(baseConfig);
    const cb = () => {};
    engine.onRemoteChange = cb;
    engine.onRemoteChange = null;
    // No throw — callback management works
  });

  it('syncNow() aggregates push and pull results', async () => {
    const engine = new SyncEngine(baseConfig);
    const result = await engine.syncNow([], 0);
    // With the mocked client, pull returns an error but syncNow must not throw
    expect(result.startedAt).toBeLessThanOrEqual(result.finishedAt);
    expect(typeof result.pushed).toBe('number');
    expect(typeof result.pulled).toBe('number');
  });
});
