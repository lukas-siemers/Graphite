import React, { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

type AuthGateComponent = (props: { children: React.ReactNode }) => React.JSX.Element;

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return {
      error: (error?.message || 'Unknown error') + (error?.stack ? '\n' + error.stack : ''),
    };
  }

  render() {
    if (this.state.error) {
      return <StartupProbeScreen stage="root-render" error={this.state.error} />;
    }

    return this.props.children;
  }
}

function StartupProbeScreen({
  stage,
  detail,
  error,
}: {
  stage: string;
  detail?: string;
  error?: string | null;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: '#131313',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
      }}
    >
      <Text style={{ color: '#F28500', fontSize: 20, fontWeight: '700' }}>
        Graphite startup probe
      </Text>
      <Text style={{ color: '#DCDDDE', fontSize: 13, marginTop: 16, textAlign: 'center' }}>
        Stage: {stage}
      </Text>
      {detail && (
        <Text style={{ color: '#9CA3AF', fontSize: 12, marginTop: 8, textAlign: 'center' }}>
          {detail}
        </Text>
      )}
      {error && (
        <Text style={{ color: '#FCA5A5', fontSize: 12, marginTop: 16, textAlign: 'center' }}>
          {error}
        </Text>
      )}
    </View>
  );
}

export default function RootLayout() {
  const [stage, setStage] = useState('root-mounted');
  const [error, setError] = useState<string | null>(null);
  const [AuthGate, setAuthGate] = useState<AuthGateComponent | null>(null);

  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        setStage('auth-storage-config');
        if (Platform.OS !== 'web') {
          const SecureStore = require('expo-secure-store');
          const syncModule = require('@graphite/sync') as {
            setAuthStorage?: (storage: {
              getItem: (key: string) => Promise<string | null>;
              setItem: (key: string, value: string) => Promise<void>;
              removeItem: (key: string) => Promise<void>;
            }) => void;
          };

          if (!syncModule.setAuthStorage) {
            throw new Error('setAuthStorage export was not available.');
          }

          syncModule.setAuthStorage({
            getItem: (key: string) => SecureStore.getItemAsync(key),
            setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
            removeItem: (key: string) => SecureStore.deleteItemAsync(key),
          });
        }

        setStage('auth-gate-import');
        const authGateModule = require('../components/auth/AuthGate') as {
          default?: AuthGateComponent;
        };

        if (!authGateModule.default) {
          throw new Error('AuthGate default export was not available.');
        }

        if (!active) return;
        setAuthGate(() => authGateModule.default as AuthGateComponent);
        setStage('auth-gate-ready');
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        setStage('root-boot-failed');
      }
    }

    void boot();

    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return <StartupProbeScreen stage={stage} error={error} />;
  }

  if (!AuthGate) {
    return (
      <StartupProbeScreen
        stage={stage}
        detail="The root layout is alive. Configuring auth storage and loading AuthGate next."
      />
    );
  }

  return (
    <RootErrorBoundary>
      <StatusBar
        hidden={Platform.OS === 'ios'}
        style="light"
        backgroundColor="transparent"
        translucent
      />
      <AuthGate>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthGate>
    </RootErrorBoundary>
  );
}
