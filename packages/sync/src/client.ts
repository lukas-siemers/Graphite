import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase expects a storage interface with these three methods.
 * Both sync and async return types are accepted.
 */
export interface AuthStorage {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
  removeItem: (key: string) => void | Promise<void>;
}

let client: SupabaseClient | null = null;
let authStorage: AuthStorage | undefined;
let credsOverride: { url: string; anonKey: string } | null = null;

/**
 * Set the auth storage adapter before the first getSupabaseClient() call.
 * React Native doesn't have localStorage, so the mobile app must call this
 * at startup with expo-secure-store (or AsyncStorage) as the backend.
 * Desktop/web can skip this — localStorage works natively.
 */
export function setAuthStorage(storage: AuthStorage): void {
  authStorage = storage;
  // Reset singleton so next call picks up the new storage
  client = null;
}

/**
 * Provide Supabase credentials at runtime. Required on the Electron
 * desktop renderer, where `process.env` is empty and the URL + anon key
 * are fetched from the main process via IPC at startup.
 *
 * Calling this resets the singleton client so the next getSupabaseClient()
 * call picks up the new creds.
 */
export function setSupabaseCredentials(url: string, anonKey: string): void {
  credsOverride = { url, anonKey };
  client = null;
}

/**
 * Returns a singleton Supabase client.
 * Only called from within packages/sync — never from UI components.
 */
export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  // Prefer runtime-provided creds (desktop IPC path) over baked-in env
  // (mobile Expo build). This lets the desktop renderer hand the URL +
  // anon key to the sync engine without the engine having to know which
  // runtime it's in.
  const url = credsOverride?.url || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const key = credsOverride?.anonKey || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!url || !key) {
    console.warn('Supabase credentials not configured — sync disabled.');
    client = createClient('https://placeholder.supabase.co', 'placeholder');
    return client;
  }

  client = createClient(url, key, {
    auth: {
      ...(authStorage ? { storage: authStorage } : {}),
    },
  });
  return client;
}

/**
 * Reset the singleton (used in tests).
 */
export function resetSupabaseClient(): void {
  client = null;
}
