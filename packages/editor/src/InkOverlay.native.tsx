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
   * Build 118: called when the eraser tool crosses one or more existing
   * strokes. The parent resolves `ids` against spatialDoc.inkStrokes and
   * filters them out in the next onInkChange.
   */
  onEraseStrokes?: (ids: string[]) => void;
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
  /** Build 118: 'pen' appends new strokes, 'eraser' deletes existing. */
  tool?: 'pen' | 'eraser';
}

// Build 118: stroke-level eraser hit test. Returns true if the eraser
// circle at (x, y) with `radius` intersects any segment of `stroke`.
// Straight-line segment distance is sufficient for the polyline shape
// we store; pressure-varying stroke width is ignored (we use the stored
// base width plus the eraser radius).
const ERASER_RADIUS = 14;
function strokeHit(stroke: SpatialInkStroke, x: number, y: number): boolean {
  const r = ERASER_RADIUS + stroke.width;
  const r2 = r * r;
  const pts = stroke.points;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const dx = p.x - x;
    const dy = p.y - y;
    if (dx * dx + dy * dy <= r2) return true;
    if (i > 0) {
      const a = pts[i - 1];
      const abx = p.x - a.x;
      const aby = p.y - a.y;
      const apx = x - a.x;
      const apy = y - a.y;
      const ab2 = abx * abx + aby * aby;
      if (ab2 === 0) continue;
      let t = (apx * abx + apy * aby) / ab2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const cx = a.x + abx * t;
      const cy = a.y + aby * t;
      const ddx = x - cx;
      const ddy = y - cy;
      if (ddx * ddx + ddy * ddy <= r2) return true;
    }
  }
  return false;
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
  onEraseStrokes,
  onResponderGrantDiagnostic,
  strokeColor = '#FFFFFF',
  strokeWidth = 2,
  tool = 'pen',
}: InkOverlayProps) {
  const strokeColorRef = useRef(strokeColor);
  const strokeWidthRef = useRef(strokeWidth);
  const toolRef = useRef(tool);
  const strokesRef = useRef(strokes);
  strokeColorRef.current = strokeColor;
  strokeWidthRef.current = strokeWidth;
  toolRef.current = tool;
  strokesRef.current = strokes;
  const [activeStroke, setActiveStroke] = useState<SpatialInkStroke | null>(null);
  const activeRef = useRef<SpatialInkStroke | null>(null);
  // Build 118: ids of strokes the eraser has hit during the current pan.
  // Buffered so one erase gesture can remove multiple strokes and emit a
  // single onEraseStrokes call at gesture end.
  const erasedIdsRef = useRef<Set<string>>(new Set());

  const handleStart = useCallback(
    (x: number, y: number, pressure: number, tilt: number) => {
      // Build 118: branch on current tool. Pen starts a new stroke; eraser
      // begins a hit-test accumulator — no visible cursor for now.
      if (toolRef.current === 'eraser') {
        erasedIdsRef.current = new Set();
        for (const s of strokesRef.current) {
          if (!erasedIdsRef.current.has(s.id) && strokeHit(s, x, y)) {
            erasedIdsRef.current.add(s.id);
          }
        }
        return;
      }
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
      if (toolRef.current === 'eraser') {
        for (const s of strokesRef.current) {
          if (!erasedIdsRef.current.has(s.id) && strokeHit(s, x, y)) {
            erasedIdsRef.current.add(s.id);
          }
        }
        return;
      }
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
    if (toolRef.current === 'eraser') {
      const ids = Array.from(erasedIdsRef.current);
      erasedIdsRef.current = new Set();
      if (ids.length > 0) onEraseStrokes?.(ids);
      return;
    }
    const s = activeRef.current;
    if (!s) return;
    activeRef.current = null;
    setActiveStroke(null);
    onNewStroke?.(s);
  }, [onNewStroke, onEraseStrokes]);

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
