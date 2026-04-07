// IMPORTANT: @supabase/supabase-js is NOT imported at module scope.
// Top-level imports execute during module initialization, which happens
// before any try-catch can protect them. If supabase-js has side effects
// that crash in Hermes production mode on iOS 26, a top-level import
// would kill the app on launch with no way to catch the error.
//
// Instead, we use dynamic require() inside getSupabaseClient(), which
// only executes when sync is actually needed.

let client: any = null;

/**
 * Returns a singleton Supabase client.
 * Only called from within packages/sync — never from UI components.
 */
export function getSupabaseClient(): any {
  if (client) return client;

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

  // Lazy-load supabase-js to avoid module-scope crashes in Hermes
  let createClient: any;
  try {
    createClient = require('@supabase/supabase-js').createClient;
  } catch (e) {
    console.warn('Failed to load @supabase/supabase-js:', e);
    return null;
  }

  if (!url || !key) {
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
