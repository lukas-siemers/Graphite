/**
 * InkPassiveOverlay — Build 124.
 *
 * A read-only, SVG-based renderer for committed SpatialInkStroke[]. Exists
 * so that drawn strokes remain visible when the pencil toggle is OFF without
 * keeping the heavy Skia-backed InkOverlay mounted (which triggered the iOS
 * 26 / iPad Pro M4 / rn-skia 2.2.12 MTLTextureDescriptor crash — see crash
 * 1380A016- in the repo history).
 *
 * Separation of concerns:
 *   - InkOverlay.native (Skia) — mounts only while inkMode=true. Handles
 *     gesture capture + renders the active stroke.
 *   - InkPassiveOverlay (this file, react-native-svg) — ALWAYS mounts. Never
 *     captures touches. Renders committed strokes from spatialDoc.inkStrokes.
 *
 * react-native-svg uses UIKit's Core Graphics drawing path, not Metal. It's
 * much lighter than Skia for static polyline rendering and doesn't trip the
 * Metal validator. Pressure-varying stroke width is approximated by the
 * average-pressure formula already used by the Skia overlay (stroke.width
 * * (0.5 + 0.5 * avg)). Per-point width variation is flattened — a
 * limitation we accept for the passive display; the Skia renderer still
 * handles variable-width strokes during live drawing.
 */
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import type { SpatialInkStroke, StrokePoint } from '@graphite/canvas';

export interface InkPassiveOverlayProps {
  strokes: SpatialInkStroke[];
  width: number;
  height: number;
}

function averagePressure(points: StrokePoint[]): number {
  if (points.length === 0) return 0.5;
  let sum = 0;
  for (const p of points) sum += p.pressure;
  return sum / points.length;
}

function pointsToPolylineString(points: StrokePoint[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

export function InkPassiveOverlay({
  strokes,
  width,
  height,
}: InkPassiveOverlayProps) {
  const rendered = useMemo(
    () =>
      strokes.map((s) => {
        const avg = averagePressure(s.points);
        return {
          id: s.id,
          points: pointsToPolylineString(s.points),
          stroke: s.color,
          strokeWidth: s.width * (0.5 + 0.5 * avg),
          opacity: s.opacity,
        };
      }),
    [strokes],
  );

  // pointerEvents='none' so taps always pass through to the text editor
  // below; this overlay is display-only.
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={width || '100%'} height={height || '100%'}>
        {rendered.map((r) => (
          <Polyline
            key={r.id}
            points={r.points}
            stroke={r.stroke}
            strokeWidth={r.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={r.opacity}
            fill="none"
          />
        ))}
      </Svg>
    </View>
  );
}
