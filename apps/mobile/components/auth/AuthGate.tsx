import React, { useEffect, useState, useCallback, type ReactNode } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { tokens } from '@graphite/ui';
import { getSupabaseClient } from '@graphite/sync';
import type { Session } from '@supabase/supabase-js';
import LoginScreen from './LoginScreen';

interface AuthGateProps {
  children: ReactNode;
}

/**
 * AuthGate wraps the app and manages Supabase authentication state.
 *
 * - While loading: shows a splash screen.
 * - If unauthenticated: shows LoginScreen.
 * - If authenticated (or skipped): renders children.
 *
 * "Continue without account" skips auth entirely and disables sync.
 * The session is held in component state; the sync engine reads the
 * userId from the session when it starts.
 */
export default function AuthGate({ children }: AuthGateProps) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [skipped, setSkipped] = useState(false);

  useEffect(() => {
    let mounted = true;
    let cleanupListener: (() => void) | undefined;

    // Safety timeout: if loadSession hangs (e.g. getSession() never resolves
    // in a production RN build without localStorage), force-exit loading state
    // so the user sees the LoginScreen instead of an infinite black screen.
    const safetyTimer = setTimeout(() => {
      if (mounted) setLoading(false);
    }, 5000);

    async function loadSession() {
      try {
        // Skip Supabase entirely if credentials aren't configured (offline/free mode)
        const url = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
        const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
        if (!url || !key) {
          return;
        }

        const supabase = getSupabaseClient();

        // Race against a timeout — getSession() can hang in production RN
        // builds where localStorage is unavailable.
        const result = await Promise.race([
          supabase.auth.getSession(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
        ]);

        if (mounted && result && typeof result === 'object' && 'data' in result) {
          setSession((result as { data: { session: Session | null } }).data.session);
        }

        // Listen for auth state changes (login, logout, token refresh)
        const { data: listener } = supabase.auth.onAuthStateChange(
          (_event, newSession) => {
            if (mounted) {
              setSession(newSession);
            }
          },
        );

        cleanupListener = () => listener.subscription.unsubscribe();
      } catch {
        // Supabase credentials not configured or failed — allow offline mode
      } finally {
        clearTimeout(safetyTimer);
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadSession();
    return () => {
      mounted = false;
      clearTimeout(safetyTimer);
      cleanupListener?.();
    };
  }, []);

  const handleAuth = useCallback(
    async (email: string, password: string, mode: 'signin' | 'signup') => {
      const supabase = getSupabaseClient();

      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      // onAuthStateChange will update the session automatically
    },
    [],
  );

  const handleSkip = useCallback(() => {
    setSkipped(true);
  }, []);

  // Loading state
  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: tokens.bgBase,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text
          style={{
            fontSize: 18,
            fontWeight: '700',
            color: tokens.textPrimary,
            letterSpacing: -0.5,
            marginBottom: 16,
          }}
        >
          Graphite
        </Text>
        <ActivityIndicator color={tokens.accent} />
      </View>
    );
  }

  // Authenticated or skipped — render the app
  if (session || skipped) {
    return <>{children}</>;
  }

  // Show login screen
  return <LoginScreen onAuth={handleAuth} onSkip={handleSkip} />;
}

/**
 * Hook to access the current auth session from anywhere in the app.
 * Returns null if the user skipped auth or is not logged in.
 *
 * NOTE: This is a simple helper. For production, consider a Zustand
 * store or React context to avoid redundant getSession calls.
 */
export async function getCurrentSession(): Promise<Session | null> {
  try {
    const supabase = getSupabaseClient();
    const { data } = await supabase.auth.getSession();
    return data.session;
  } catch {
    return null;
  }
}
