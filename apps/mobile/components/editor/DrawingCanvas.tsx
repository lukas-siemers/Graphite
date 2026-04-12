import * as React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { tokens } from '@graphite/ui';

export interface DrawingCanvasProps {
  initialDrawingBase64: string | null;
  onDrawingChange: (base64: string) => void;
  onDone: () => void;
}

/**
 * Full-screen drawing surface backed by react-native-pencil-kit (mym0404).
 *
 * This component is rendered *instead of* the text editor when `drawMode`
 * is on -- never beside it. Mounting the native PencilKit view inside the
 * same tree as the TextInput was the root cause of the builds 46-50
 * black-screen regressions, so we keep the two modes mutually exclusive
 * at the React tree level (see Editor.tsx).
 *
 * Startup safety: we `require()` the npm package lazily (not at module
 * scope) so nothing imports PencilKit until the user actually taps the
 * Draw button. This mirrors the CanvasRenderer pattern from CLAUDE.md's
 * "iOS production startup trap" section.
 *
 * Expo Go has no PencilKit binary, so when we detect Expo Go we render a
 * stub instead of attempting to load the native view.
 */
export default function DrawingCanvas(props: DrawingCanvasProps) {
  const { initialDrawingBase64, onDrawingChange, onDone } = props;

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

  return <PencilKitSurface initialDrawingBase64={initialDrawingBase64} onDrawingChange={onDrawingChange} onDone={onDone} />;
}

/**
 * Inner component that actually mounts PencilKitView. Separated so the
 * lazy require + ref logic lives in its own mount lifecycle.
 */
function PencilKitSurface({
  initialDrawingBase64,
  onDrawingChange,
  onDone,
}: DrawingCanvasProps) {
  // Lazy require keeps PencilKit out of the app startup path.
  let PencilKitView: any = null;
  try {
    const mod = require('react-native-pencil-kit');
    PencilKitView = mod.default ?? mod;
  } catch (_err) {
    PencilKitView = null;
  }

  const pencilKitRef = React.useRef<any>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load initial drawing data once on mount. After that, PencilKit is the
  // source of truth. Re-loading when the prop changes (e.g. after our own
  // debounced save round-trips through the store) would replace strokes
  // drawn during the save window with a stale snapshot.
  const initialDrawingRef = React.useRef(initialDrawingBase64);
  React.useEffect(() => {
    const initial = initialDrawingRef.current;
    if (initial && pencilKitRef.current) {
      const timer = setTimeout(() => {
        pencilKitRef.current?.loadBase64Data(initial);
      }, 100);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, []);

  // Auto-save on drawing change (debounced 500ms)
  const handleDrawingDidChange = React.useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const b64 = await pencilKitRef.current?.getBase64Data();
        if (b64) {
          onDrawingChange(b64);
        }
      } catch (_err) {
        // Silently ignore save failures
      }
    }, 500);
  }, [onDrawingChange]);

  // Save on Done press (immediate, not debounced)
  const handleDone = React.useCallback(async () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    try {
      const b64 = await pencilKitRef.current?.getBase64Data();
      if (b64) {
        onDrawingChange(b64);
      }
    } catch (_err) {
      // Silently ignore
    }
    onDone();
  }, [onDrawingChange, onDone]);

  if (!PencilKitView) {
    return (
      <DrawingStub
        message="PencilKit module is not linked in this build."
        onDone={onDone}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.bgBase }}>
      <PencilKitView
        ref={pencilKitRef}
        style={{ flex: 1 }}
        drawingPolicy="pencilonly"
        backgroundColor={tokens.bgBase}
        onCanvasViewDrawingDidChange={handleDrawingDidChange}
      />
      <DoneButton onPress={handleDone} />
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
