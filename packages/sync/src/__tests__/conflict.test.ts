import { describe, it, expect } from 'vitest';
import { resolveByLastWrite } from '../conflict';

describe('resolveByLastWrite', () => {
  it('picks local when local has the larger updatedAt', () => {
    const local = { id: 'a', updatedAt: 200 };
    const remote = { id: 'a', updatedAt: 100 };
    const result = resolveByLastWrite(local, remote);
    expect(result.winner).toBe('local');
    expect(result.value).toBe(local);
  });

  it('picks remote when remote has the larger updatedAt', () => {
    const local = { id: 'a', updatedAt: 100 };
    const remote = { id: 'a', updatedAt: 200 };
    const result = resolveByLastWrite(local, remote);
    expect(result.winner).toBe('remote');
    expect(result.value).toBe(remote);
  });

  it('ties go to remote (Supabase is authoritative)', () => {
    const local = { id: 'a', updatedAt: 150 };
    const remote = { id: 'a', updatedAt: 150 };
    const result = resolveByLastWrite(local, remote);
    expect(result.winner).toBe('remote');
    expect(result.value).toBe(remote);
  });
});
