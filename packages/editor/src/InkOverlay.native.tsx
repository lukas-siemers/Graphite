/**
 * InkOverlay (native) — renders SpatialInkStroke[] on a Skia canvas.
 *
 * Build 116: touch handling migrated from RN's responder system to
 * react-native-gesture-handler's Gesture.Pan. The previous responder-
 * based implementation could not compete with the parent ScrollView's
 * native UIPanGestureRecognizer even with scrollEnabled={!inkMode}; on
 * iPad iOS 18+ the scroll pan claimed every pencil touch BEFORE the RN
 * responder negotiation got a chance, so InkOverlay's onStartShouldSet-
 * Responder never fired. Build 115's pc:0 telemetry confirmed it.
 *
 * Gesture.Pan runs at the UIGestureRecognizer layer alongside the
 * ScrollView's pan recognizer, so the two compete on equal native
 * footing. Pan detects Apple Pencil touches correctly on iPad and
 * exposes pressure via e.x/y/velocityX. Pressure sensitivity is kept
 * at a flat 0.5 on native for now (Pencil Pro pressure is in nativeEvent
 * under a different shape; wire that in a follow-up build).
 *
 * Pressure → stroke width: `stroke.width * (0.5 + 0.5 * pressure)`, the
 * same shape used by the legacy drawing canvas.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Canvas,
  Path,
  Skia,
  type SkPath,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { nanoid } from 'nanoid/non-secure';
import type { SpatialInkStroke, StrokePoint } from './ink-types';

export interface InkOverlayProps {
  strokes: SpatialInkStroke[];
  width: number;
  height: number;
  pointerEvents?: 'none' | 'auto';
  onNewStroke?: (stroke: SpatialInkStroke) => void;
  /**
   * Build 115 diagnostic: notified on every Pan.onBegin that
   * successfully claims a touch (finger or Apple Pencil). Lets the
   * parent render a pc:N counter in the phase pill so we can see
   * on-device whether touches are landing. If pc stays at 0 when the
   * user tries to draw, the native gesture system itself is rejecting
   * the pan — a much deeper bug than the responder-race we just fixed.
   */
  onResponderGrantDiagnostic?: () => void;
  /** Build 117: pencil color for new strokes. Defaults to #FFFFFF. */
  strokeColor?: string;
  /** Build 117: pencil width for new strokes. Defaults to 2. */
  strokeWidth?: number;
}

function strokeToPath(stroke: SpatialInkStroke): SkPath {
  const path = Skia.Path.Make();
  const { points } = stroke;
  if (points.length === 0) return path;
  path.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    path.lineTo(points[i].x, points[i].y);
  }
  return path;
}

function averagePressure(points: StrokePoint[]): number {
  if (points.length === 0) return 0.5;
  let sum = 0;
  for (const p of points) sum += p.pressure;
  return sum / points.length;
}

export function InkOverlay({
  strokes,
  width,
  height,
  pointerEvents = 'none',
  onNewStroke,
  onResponderGrantDiagnostic,
  strokeColor = '#FFFFFF',
  strokeWidth = 2,
}: InkOverlayProps) {
  const strokeColorRef = useRef(strokeColor);
  const strokeWidthRef = useRef(strokeWidth);
  strokeColorRef.current = strokeColor;
  strokeWidthRef.current = strokeWidth;
  const [activeStroke, setActiveStroke] = useState<SpatialInkStroke | null>(null);
  const activeRef = useRef<SpatialInkStroke | null>(null);

  const handleStart = useCallback(
    (x: number, y: number, pressure: number, tilt: number) => {
      // Build 117: read color + width from refs so the stroke reflects
      // the current selection at the moment it starts, not whatever was
      // set at last memoization of this callback.
      const s: SpatialInkStroke = {
        id: nanoid(),
        color: strokeColorRef.current,
        width: strokeWidthRef.current,
        opacity: 1,
        points: [{ x, y, pressure, tilt, timestamp: Date.now() }],
      };
      activeRef.current = s;
      setActiveStroke(s);
    },
    [],
  );

  const handleMove = useCallback(
    (x: number, y: number, pressure: number, tilt: number) => {
      const s = activeRef.current;
      if (!s) return;
      const next: SpatialInkStroke = {
        ...s,
        points: [...s.points, { x, y, pressure, tilt, timestamp: Date.now() }],
      };
      activeRef.current = next;
      setActiveStroke(next);
    },
    [],
  );

  const handleEnd = useCallback(() => {
    const s = activeRef.current;
    if (!s) return;
    activeRef.current = null;
    setActiveStroke(null);
    onNewStroke?.(s);
  }, [onNewStroke]);

  // Build 116: Gesture.Pan() at the native gesture layer.
  // - minDistance: 0 captures taps-turned-to-strokes immediately, not
  //   after a threshold.
  // - runOnJS on each callback so we can mutate React state.
  // - onBegin fires on finger-down; onUpdate fires per move; onEnd/
  //   onFinalize fire on release.
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((e) => {
          handleStart(e.x, e.y, 0.5, 0);
          onResponderGrantDiagnostic?.();
        })
        .onUpdate((e) => {
          handleMove(e.x, e.y, 0.5, 0);
        })
        .onEnd(() => {
          handleEnd();
        })
        .onFinalize(() => {
          handleEnd();
        })
        .runOnJS(true),
    [handleStart, handleMove, handleEnd, onResponderGrantDiagnostic],
  );

  const paths = useMemo(
    () =>
      strokes.map((s) => ({
        stroke: s,
        path: strokeToPath(s),
        avgPressure: averagePressure(s.points),
      })),
    [strokes],
  );

  const activePath = useMemo(
    () =>
      activeStroke
        ? {
            stroke: activeStroke,
            path: strokeToPath(activeStroke),
            avgPressure: averagePressure(activeStroke.points),
          }
        : null,
    [activeStroke],
  );

  // Build 116: wrap the overlay in GestureDetector so Pan is attached
  // to the native view. pointerEvents on the inner View still gates
  // whether the gesture is active (when pointerEvents='none' we don't
  // activate the gesture logic — parent controls this via inkMode).
  const isActive = pointerEvents === 'auto';
  const content = (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={pointerEvents}
    >
      <Canvas style={styles.canvas}>
        {paths.map(({ stroke, path, avgPressure }) => (
          <Path
            key={stroke.id}
            path={path}
            color={stroke.color}
            style="stroke"
            strokeWidth={stroke.width * (0.5 + 0.5 * avgPressure)}
            strokeCap="round"
            strokeJoin="round"
            opacity={stroke.opacity}
          />
        ))}
        {activePath ? (
          <Path
            path={activePath.path}
            color={activePath.stroke.color}
            style="stroke"
            strokeWidth={
              activePath.stroke.width * (0.5 + 0.5 * activePath.avgPressure)
            }
            strokeCap="round"
            strokeJoin="round"
            opacity={activePath.stroke.opacity}
          />
        ) : null}
      </Canvas>
    </View>
  );

  if (!isActive) {
    // When inkMode is false the overlay is in the tree but not capturing
    // touches. Skip the gesture wrapper entirely to avoid any overhead
    // / hit-test interference with the text editor below.
    return content;
  }

  return <GestureDetector gesture={panGesture}>{content}</GestureDetector>;
}

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
  },
});
