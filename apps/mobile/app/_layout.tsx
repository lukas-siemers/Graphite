import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, LogBox } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

// Capture the FIRST fatal JS error globally so we can display it
// instead of letting RCTFatal kill the app. This catches errors that
// happen before React's ErrorBoundary mounts (module init, TurboModule
// calls, etc.).
let _globalError: string | null = null;
const _originalHandler = ErrorUtils.getGlobalHandler();
ErrorUtils.setGlobalHandler((error, isFatal) => {
  if (isFatal && !_globalError) {
    _globalError = (error?.message || String(error)) +
      (error?.stack ? '\n\n' + error.stack : '');
  }
  // Don't call the original handler for fatal errors — that triggers
  // RCTFatal which aborts the process. For non-fatal errors, pass through.
  if (!isFatal && _originalHandler) {
    _originalHandler(error, isFatal);
  }
});

// Lazy import AuthGate to avoid crashing during module load if
// @supabase/supabase-js has issues in production JSC.
let AuthGate: React.ComponentType<{ children: React.ReactNode }> | null = null;
try {
  AuthGate = require('../components/auth/AuthGate').default;
} catch (e: any) {
  _globalError = 'AuthGate import failed: ' + (e?.message || String(e));
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
  const [globalErr, setGlobalErr] = useState<string | null>(_globalError);

  // Poll for global errors that were caught before React mounted
  useEffect(() => {
    if (_globalError && !globalErr) setGlobalErr(_globalError);
    const interval = setInterval(() => {
      if (_globalError && !globalErr) setGlobalErr(_globalError);
    }, 500);
    return () => clearInterval(interval);
  }, [globalErr]);

  // If a global error was caught, show it instead of crashing
  if (globalErr) {
    return (
      <View style={{ flex: 1, backgroundColor: '#1E1E1E', padding: 24, paddingTop: 80 }}>
        <Text style={{ color: '#FF6B6B', fontSize: 18, fontWeight: '700', marginBottom: 16 }}>
          Startup Error
        </Text>
        <ScrollView>
          <Text style={{ color: '#DCDDDE', fontSize: 11, lineHeight: 16 }}>
            {globalErr}
          </Text>
        </ScrollView>
      </View>
    );
  }

  const Gate = AuthGate;

  return (
    <ErrorBoundary>
      <StatusBar style="light" backgroundColor="transparent" translucent />
      {Gate ? (
        <Gate>
          <Stack screenOptions={{ headerShown: false }} />
        </Gate>
      ) : (
        <Stack screenOptions={{ headerShown: false }} />
      )}
    </ErrorBoundary>
  );
}
