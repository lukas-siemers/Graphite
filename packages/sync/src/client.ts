import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * Returns a singleton Supabase client.
 * Only called from within packages/sync — never from UI components.
 */
export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!url || !key) {
    // Return a dummy client that will fail on actual API calls but won't
    // crash the app on startup. This lets the app run in offline-only mode
    // when credentials aren't configured (e.g. missing env vars in CI).
    console.warn('Supabase credentials not configured — sync disabled.');
    client = createClient('https://placeholder.supabase.co', 'placeholder');
    return client;
  }

  client = createClient(url, key);
  return client;
}

/**
 * Reset the singleton (used in tests).
 */
export function resetSupabaseClient(): void {
  client = null;
}
