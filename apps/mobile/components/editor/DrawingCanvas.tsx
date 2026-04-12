import * as React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { tokens } from '@graphite/ui';
import type { InkStroke } from '@graphite/db';

export interface DrawingCanvasProps {
  initialStrokes: InkStroke[];
  onStrokesChange: (strokes: InkStroke[]) => void;
  onDone: () => void;
}

/**
 * Full-screen drawing surface. This component is rendered *instead of* the
 * text editor when `drawMode` is on — never beside it. Mounting the native
 * PencilKit view inside the same tree as the TextInput was the root cause
 * of the builds 46-50 black-screen regressions, so we keep the two modes
 * mutually exclusive at the React tree level (see Editor.tsx).
 *
 * Startup safety: we `require()` the native module lazily (not at module
 * scope) so nothing imports PencilKit until the user actually taps the
 * Draw button. This mirrors the CanvasRenderer pattern from CLAUDE.md's
 * "iOS production startup trap" section.
 *
 * Expo Go has no PencilKit binary, so when we detect Expo Go we render a
 * stub instead of attempting to load the native view.
 */
export default function DrawingCanvas(props: DrawingCanvasProps) {
  const { initialStrokes, onStrokesChange, onDone } = props;

  // Expo Go runs the JS bundle without our custom native modules baked in.
  // Checking appOwnership === 'expo' is how CanvasRenderer used to fence
  // Skia off. If we didn't guard here, `requireNativeViewManager` would
  // throw a "view manager not found" red box on dev client launches.
  const isExpoGo = Constants.appOwnership === 'expo';

  if (Platform.OS !== 'ios' || isExpoGo) {
    return (
      <DrawingStub
        message={
          isExpoGo
            ? 'Drawing requires a dev client or TestFlight build.'
            : 'Drawing is only available on iPad for now.'
        }
        onDone={onDone}
      />
    );
  }

  // Lazy require keeps PencilKit out of the app startup path. The
  // require() is intentionally inside the render body — if we moved it to
  // module scope we'd be back in the black-screen trap.
  let GraphitePencilKitView: React.ComponentType<{
    style?: any;
    initialStrokes?: unknown[];
    onStrokesChanged?: (event: {
      nativeEvent: { strokes: InkStroke[] };
    }) => void;
  }> | null = null;
  try {
    const mod = require('graphite-pencil-kit');
    GraphitePencilKitView = mod.GraphitePencilKitView ?? null;
  } catch (_err) {
    GraphitePencilKitView = null;
  }

  if (!GraphitePencilKitView) {
    return (
      <DrawingStub
        message="PencilKit module is not linked in this build."
        onDone={onDone}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.bgBase }}>
      <GraphitePencilKitView
        style={{ flex: 1 }}
        initialStrokes={initialStrokes}
        onStrokesChanged={(event) => {
          const strokes = event?.nativeEvent?.strokes ?? [];
          onStrokesChange(strokes);
        }}
      />
      <DoneButton onPress={onDone} />
    </View>
  );
}

function DoneButton({ onPress }: { onPress: () => void }) {
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
      }}
    >
      <Pressable
        onPress={onPress}
        accessibilityLabel="Exit drawing mode"
        style={({ pressed }) => ({
          paddingHorizontal: 14,
          height: 32,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? tokens.accentPressed : tokens.accent,
        })}
      >
        <Text
          style={{
            fontSize: 12,
            fontWeight: '700',
            color: tokens.textPrimary,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          Done
        </Text>
      </Pressable>
    </View>
  );
}

function DrawingStub({
  message,
  onDone,
}: {
  message: string;
  onDone: () => void;
}) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: tokens.bgBase,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
      }}
    >
      <Text
        style={{
          fontSize: 14,
          color: tokens.textMuted,
          textAlign: 'center',
          marginBottom: 16,
        }}
      >
        {message}
      </Text>
      <Pressable
        onPress={onDone}
        style={({ pressed }) => ({
          paddingHorizontal: 14,
          height: 32,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? tokens.accentPressed : tokens.accent,
        })}
      >
        <Text
          style={{
            fontSize: 12,
            fontWeight: '700',
            color: tokens.textPrimary,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          Back
        </Text>
      </Pressable>
    </View>
  );
}
