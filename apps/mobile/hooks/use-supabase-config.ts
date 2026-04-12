import { useEffect, useState } from 'react';

/**
 * Source the Supabase URL + anon key for the current runtime.
 *
 * On iOS / Android the values are baked into the Expo bundle via
 * `EXPO_PUBLIC_*` env vars at build time, so we read them synchronously
 * from `process.env` and the hook is ready on first render.
 *
 * On the Electron desktop renderer, `process.env` is empty (the renderer
 * is a browser context — Node globals are blocked by `contextIsolation`).
 * The main process loads the env file at startup and exposes the values
 * via the `graphite.env.getSupabaseConfig` IPC bridge. We fetch those
 * async on mount, then the sync engine spins up.
 *
 * The hook returns an object rather than a tuple so the shape can grow
 * (service URLs, feature flags) without rewriting every call site.
 */

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  /** `true` once we've finished attempting to load config — distinguishes
   *  "still loading" from "loaded but empty (offline mode)". */
  loaded: boolean;
}

type DesktopBridge = {
  env?: {
    getSupabaseConfig?: () => Promise<
      { data?: { url: string; anonKey: string } } | { error: string }
    >;
  };
};

function readDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { graphite?: DesktopBridge };
  return w.graphite ?? null;
}

export function useSupabaseConfig(): SupabaseConfig {
  // Seed synchronously from process.env so the mobile build is ready on
  // first render without a re-render cycle.
  const initialUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const initialKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

  const [config, setConfig] = useState<SupabaseConfig>({
    url: initialUrl,
    anonKey: initialKey,
    // If we already have the values from process.env we're done loading.
    // Otherwise we'll flip this to true once the IPC round-trip resolves
    // (or fails) on Electron.
    loaded: Boolean(initialUrl && initialKey),
  });

  useEffect(() => {
    // Already have values — nothing to fetch.
    if (config.loaded) return;

    const bridge = readDesktopBridge();
    if (!bridge?.env?.getSupabaseConfig) {
      // No IPC bridge (plain browser / non-Electron web). Mark as loaded
      // with empty credentials so downstream hooks fall into offline mode.
      setConfig((c) => ({ ...c, loaded: true }));
      return;
    }

    let cancelled = false;

    bridge.env
      .getSupabaseConfig()
      .then((result) => {
        if (cancelled) return;
        if ('data' in result && result.data) {
          setConfig({
            url: result.data.url ?? '',
            anonKey: result.data.anonKey ?? '',
            loaded: true,
          });
        } else {
          setConfig((c) => ({ ...c, loaded: true }));
        }
      })
      .catch(() => {
        if (cancelled) return;
        setConfig((c) => ({ ...c, loaded: true }));
      });

    return () => {
      cancelled = true;
    };
  }, [config.loaded]);

  return config;
}
