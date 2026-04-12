import * as React from 'react';
import { Pressable, Text, View } from 'react-native';
import { tokens } from '@graphite/ui';

export interface DrawingCanvasProps {
  initialDrawingBase64: string | null;
  onDrawingChange: (base64: string) => void;
  onDone: () => void;
}

/**
 * Web / Electron stub for DrawingCanvas.
 *
 * Apple PencilKit is iOS-only; on the desktop the plan is to swap in tldraw
 * later (see CLAUDE.md "Target Product Vision"). Until that lands we just
 * render an explanatory stub so the Expo Web + Electron bundles keep
 * compiling.
 */
export default function DrawingCanvas(props: DrawingCanvasProps) {
  const { onDone } = props;
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
        Drawing is only available on iPad for now.
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
