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
 * Returns a singleton Supabase client.
 * Only called from within packages/sync — never from UI components.
 */
export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

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
