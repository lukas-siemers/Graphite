import React, { useState, useEffect } from 'react';
import { Platform, View, Text } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { setAuthStorage } from '@graphite/sync';
import AuthGate from '../components/auth/AuthGate';

// React Native doesn't have localStorage. Configure Supabase to use
// expo-secure-store so auth tokens persist securely on device.
// This runs at import time — before any component mounts.
if (Platform.OS !== 'web') {
  const SecureStore = require('expo-secure-store');
  setAuthStorage({
    getItem: (key: string) => SecureStore.getItemAsync(key),
    setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
    removeItem: (key: string) => SecureStore.deleteItemAsync(key),
  });
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error: (error?.message || 'Unknown error') + (error?.stack ? '\n' + error.stack : '') };
  }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, backgroundColor: '#1E1E1E', padding: 24, justifyContent: 'center' }}>
          <Text style={{ color: '#F28500', fontSize: 16, fontWeight: '700', marginBottom: 12 }}>
            Render Error
          </Text>
          <Text style={{ color: '#DCDDDE', fontSize: 12 }}>
            {this.state.error}
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

/**
 * Diagnostic build — renders a bright visible screen immediately to confirm
 * the JS bundle loads and React can render. Bypasses AuthGate, Supabase,
 * and Expo Router to isolate the black screen issue.
 *
 * TODO: Remove this diagnostic after confirming the production build works.
 */
export default function RootLayout() {
  const [phase, setPhase] = useState('mount');

  useEffect(() => {
    setPhase('effect');
    // After 2s, try rendering the real app
    const timer = setTimeout(() => setPhase('app'), 2000);
    return () => clearTimeout(timer);
  }, []);

  // Phase 1: Immediate render — proves JS loaded and React works
  if (phase === 'mount' || phase === 'effect') {
    return (
      <View style={{ flex: 1, backgroundColor: '#FF0000', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontSize: 32, fontWeight: '900', color: '#FFFFFF' }}>
          BUILD 32 - {phase.toUpperCase()}
        </Text>
        <Text style={{ fontSize: 16, color: '#FFFFFF', marginTop: 12 }}>
          If you see this, JS bundle loaded OK
        </Text>
        <Text style={{ fontSize: 14, color: '#FFFFFF', marginTop: 8 }}>
          Platform: {Platform.OS} | Arch: {typeof global?.HermesInternal !== 'undefined' ? 'Hermes' : 'JSC'}
        </Text>
        <Text style={{ fontSize: 14, color: '#FFFFFF', marginTop: 4 }}>
          NewArch: {typeof global?._IS_FABRIC !== 'undefined' ? 'YES' : 'UNKNOWN'}
        </Text>
      </View>
    );
  }

  // Phase 2: Real app
  return (
    <ErrorBoundary>
      <StatusBar style="light" backgroundColor="transparent" translucent />
      <AuthGate>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthGate>
    </ErrorBoundary>
  );
}
