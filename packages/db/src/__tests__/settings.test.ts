import { describe, it, expect, beforeEach } from 'vitest';
import { createExpoCompatibleDb } from '../test-utils';
import { getSetting, setSetting } from '../operations/settings';

describe('settings operations', () => {
  let db: ReturnType<typeof createExpoCompatibleDb>;

  beforeEach(() => {
    db = createExpoCompatibleDb();
  });

  it('getSetting returns null for unknown key', async () => {
    const value = await getSetting(db, 'nonexistent');
    expect(value).toBeNull();
  });

  it('setSetting + getSetting round-trip works', async () => {
    await setSetting(db, 'theme', 'dark');
    const value = await getSetting(db, 'theme');
    expect(value).toBe('dark');
  });

  it('setSetting overwrites existing value (upsert)', async () => {
    await setSetting(db, 'lang', 'en');
    await setSetting(db, 'lang', 'de');
    const value = await getSetting(db, 'lang');
    expect(value).toBe('de');
  });
});
