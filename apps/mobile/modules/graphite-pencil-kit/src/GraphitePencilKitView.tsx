import { requireNativeViewManager } from 'expo-modules-core';
import * as React from 'react';
import { Platform } from 'react-native';

import type { GraphitePencilKitViewProps } from './GraphitePencilKitView.types';

/**
 * Thin wrapper around the native GraphitePencilKit view.
 *
 * On iOS we look up the view manager via `requireNativeViewManager`. On
 * every other platform (Android, Expo Web, Electron renderer) we export
 * `null`, and callers are expected to platform-branch before rendering
 * (see apps/mobile/components/editor/DrawingCanvas.tsx / .web.tsx).
 *
 * Module-level `requireNativeViewManager` is safe here — this file is only
 * imported lazily via `require()` inside DrawingCanvas.tsx's ios-only entry,
 * not at app startup. See CLAUDE.md "iOS production startup trap".
 */
const NativeView: React.ComponentType<GraphitePencilKitViewProps> | null =
  Platform.OS === 'ios'
    ? requireNativeViewManager<GraphitePencilKitViewProps>('GraphitePencilKit')
    : null;

export function GraphitePencilKitView(props: GraphitePencilKitViewProps) {
  if (!NativeView) {
    return null;
  }
  return <NativeView {...props} />;
}
