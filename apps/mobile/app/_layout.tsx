import React from 'react';
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

export default function RootLayout() {
  return (
    <ErrorBoundary>
      <StatusBar style="light" backgroundColor="transparent" translucent />
      <AuthGate>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthGate>
    </ErrorBoundary>
  );
}
