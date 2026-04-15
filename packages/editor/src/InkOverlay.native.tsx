/**
 * InkOverlay (native) — renders SpatialInkStroke[] on a Skia canvas.
 *
 * Positioned inside scroll content at absolute canvas coordinates: the parent
 * sizes it to (canvasWidth, totalCanvasHeight) and places it under the text
 * layer. When `pointerEvents === 'none'` the overlay forwards touches to the
 * text layer beneath; when `'auto'` it captures pen input and emits strokes
 * via `onNewStroke`.
 *
 * Pressure → stroke width: `stroke.width * (0.5 + 0.5 * pressure)`, the same
 * shape used by the legacy drawing canvas. Computed per-point via a Skia
 * Path with sub-segments — not a single Path.line, so we can vary width.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import {
  Canvas,
  Path,
  Skia,
  type SkPath,
} from '@shopify/react-native-skia';
import { nanoid } from 'nanoid/non-secure';
import type { SpatialInkStroke, StrokePoint } from './ink-types';

export interface InkOverlayProps {
  strokes: SpatialInkStroke[];
  width: number;
  height: number;
  pointerEvents?: 'none' | 'auto';
  onNewStroke?: (stroke: SpatialInkStroke) => void;
  /**
   * Build 115 diagnostic: notified on every onResponderGrant that
   * successfully claims a touch (finger or Apple Pencil). Lets the
   * parent render a pc:N counter in the phase pill so we can see
   * on-device whether touches are landing at all. If pc stays at 0
   * when the user tries to draw, the RN responder never grants —
   * meaning either a gesture-race with ScrollView or a known Pencil
   * bridging issue. If pc > 0 but no stroke is visible, the
   * failure is downstream (Skia paint, size 0, color mismatch).
   */
  onResponderGrantDiagnostic?: () => void;
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
}: InkOverlayProps) {
  const [activeStroke, setActiveStroke] = useState<SpatialInkStroke | null>(null);
  const activeRef = useRef<SpatialInkStroke | null>(null);

  const handleStart = useCallback(
    (x: number, y: number, pressure: number, tilt: number) => {
      const s: SpatialInkStroke = {
        id: nanoid(),
        color: '#FFFFFF',
        width: 2,
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

  return (
    <View
      // Build 112: InkOverlay fills its parent regardless of the
      // width/height props, which can start at 0 before the ScrollView's
      // onContentSizeChange fires. A zero-sized View has no hit area,
      // so the RN responder system was silently dropping every pencil
      // touch — user reported "Apple Pencil still does not work" even
      // after mounting InkOverlay in inkMode=true. absoluteFill grants
      // an immediate, always-valid hit region that matches whatever
      // parent (scroll content) size the layout resolved.
      style={StyleSheet.absoluteFill}
      pointerEvents={pointerEvents}
      onStartShouldSetResponder={() => pointerEvents === 'auto'}
      onMoveShouldSetResponder={() => pointerEvents === 'auto'}
      onResponderGrant={(e) => {
        const { locationX, locationY, force } = e.nativeEvent;
        handleStart(locationX, locationY, typeof force === 'number' ? force : 0.5, 0);
        // Build 115: notify parent for on-device pc:N counter.
        onResponderGrantDiagnostic?.();
      }}
      onResponderMove={(e) => {
        const { locationX, locationY, force } = e.nativeEvent;
        handleMove(locationX, locationY, typeof force === 'number' ? force : 0.5, 0);
      }}
      onResponderRelease={handleEnd}
      onResponderTerminate={handleEnd}
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
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  canvas: {
    flex: 1,
  },
});
