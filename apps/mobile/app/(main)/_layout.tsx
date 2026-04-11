import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

type MainShellComponent = () => React.JSX.Element;

class MainRouteErrorBoundary extends React.Component<
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
      return <StartupProbeScreen stage="main-route-render" error={this.state.error} />;
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

export default function MainLayout() {
  const [stage, setStage] = useState('main-route-mounted');
  const [error, setError] = useState<string | null>(null);
  const [MainShell, setMainShell] = useState<MainShellComponent | null>(null);

  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        setStage('main-shell-import');
        const mainShellModule = require('../../components/app/MainAppShell') as {
          default?: MainShellComponent;
        };

        if (!mainShellModule.default) {
          throw new Error('MainAppShell default export was not available.');
        }

        if (!active) return;
        setMainShell(() => mainShellModule.default as MainShellComponent);
        setStage('main-shell-ready');
      } catch (caught) {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : String(caught));
        setStage('main-shell-failed');
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

  if (!MainShell) {
    return (
      <StartupProbeScreen
        stage={stage}
        detail="The route module is alive. Loading the main app shell next."
      />
    );
  }

  return (
    <MainRouteErrorBoundary>
      <MainShell />
    </MainRouteErrorBoundary>
  );
}
