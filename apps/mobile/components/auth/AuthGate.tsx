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

    async function loadSession() {
      try {
        const supabase = getSupabaseClient();
        const { data } = await supabase.auth.getSession();
        if (mounted) {
          setSession(data.session);
        }

        // Listen for auth state changes (login, logout, token refresh)
        const { data: listener } = supabase.auth.onAuthStateChange(
          (_event, newSession) => {
            if (mounted) {
              setSession(newSession);
            }
          },
        );

        return () => {
          listener.subscription.unsubscribe();
        };
      } catch {
        // Supabase credentials not configured — allow offline mode
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadSession();
    return () => {
      mounted = false;
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
