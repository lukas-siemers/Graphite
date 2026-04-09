import { describe, it, expect } from 'vitest';
import { SyncEngine } from '../engine';
import { NotImplementedError } from '../errors';

const baseConfig = {
  supabaseUrl: 'https://stub.example',
  supabaseAnonKey: 'stub-key',
  userId: 'user-1',
};

describe('SyncEngine (Phase 2 scaffold)', () => {
  it('throws when constructed without a userId', () => {
    expect(() => new SyncEngine({ ...baseConfig, userId: '' })).toThrow();
  });

  it('starts in disabled state', () => {
    const engine = new SyncEngine(baseConfig);
    expect(engine.state).toBe('disabled');
  });

  it('start() throws NotImplementedError (Phase 2)', async () => {
    const engine = new SyncEngine(baseConfig);
    await expect(engine.start()).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('push() throws NotImplementedError (Phase 2)', async () => {
    const engine = new SyncEngine(baseConfig);
    await expect(engine.push([])).rejects.toBeInstanceOf(NotImplementedError);
  });

  it('pull() throws NotImplementedError (Phase 2)', async () => {
    const engine = new SyncEngine(baseConfig);
    await expect(engine.pull(0)).rejects.toBeInstanceOf(NotImplementedError);
  });
});
