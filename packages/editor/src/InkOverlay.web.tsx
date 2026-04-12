/**
 * InkOverlay — SVG stroke renderer for web / Electron (Stage 4).
 *
 * Metro and webpack both resolve `.web.tsx` ahead of `.tsx` when bundling
 * for the web target, so desktop and Expo-web builds pick up THIS file
 * instead of the Skia-powered native variant. That's important: pulling
 * `@shopify/react-native-skia` into a non-native bundle would fail at
 * module load.
 *
 * This is the Stage 4 renderer (replacing the Stage 3 stub). It consumes
 * the same `CanvasSchemaV1.InkStroke[]` shape as the native Skia overlay
 * and carries the same `InkOverlayProps` contract so the parent editor
 * never branches on platform.
 *
 * Geometry:
 *   All stroke-to-path conversion is shared with the native Skia overlay
 *   via `./ink-paths.ts` (Stage 3). We never duplicate the smoothing
 *   algorithm — a note written on iPad and viewed on desktop renders
 *   from the exact same command list, just translated into different
 *   primitives. That guarantees visual parity across platforms without
 *   having to diff two implementations.
 *
 * Output:
 *   - One `<path>` per renderable stroke.
 *   - `d` is composed of SVG move-to / line-to / quadratic-Bezier tokens
 *     translated 1:1 from the shared `PathCommand` list.
 *   - `stroke-width` comes straight from `BuiltStrokePath.width` (the
 *     shared helper already folds base-width × avg-pressure together).
 *   - `fill = none` + round linecap/linejoin — outlined path, not a
 *     filled ribbon. Pressure-variable ribbons (perfect-freehand
 *     getStroke -> filled polygon) are out of scope for v1.5.
 *
 * Container:
 *   Absolutely positioned, `pointer-events: none` so it never intercepts
 *   text selection or clicks on the editor below.
 */

import React from 'react';
import type { CSSProperties } from 'react';
import type { CanvasSchemaV1 } from '@graphite/db';
import { buildPaths, type PathCommand, type BuiltStrokePath } from './ink-paths';

export interface InkOverlayProps {
  /** Canvas ink strokes in v1 schema shape. Empty array is safe but
   *  wasteful — the parent should avoid mounting at all in that case. */
  strokes: CanvasSchemaV1.InkStroke[];
  /** Overlay width in px — should match the scroll content width, not the
   *  680px text column, so strokes past the column render without clipping. */
  width: number;
  /** Overlay height in px — as tall as the scroll content so strokes at
   *  any y coordinate are visible without clipping. */
  height: number;
}

/**
 * Translate a shared `PathCommand[]` (from ink-paths.ts) into the `d`
 * attribute string an SVG `<path>` expects. Exported for tests only.
 *
 *   moveTo        -> 'M x y'
 *   lineTo        -> 'L x y'
 *   quadTo        -> 'Q cx cy x y'
 *
 * Numbers are formatted with at most 3 decimals and trailing zeros
 * stripped so the DOM stays light for dense strokes. SVG viewports for
 * iPad ink are typically 0..1024 so three decimals is well below
 * sub-pixel resolution.
 */
export function commandsToD(commands: readonly PathCommand[]): string {
  const parts: string[] = [];
  for (const cmd of commands) {
    if (cmd.type === 'moveTo') {
      parts.push(`M ${fmt(cmd.x)} ${fmt(cmd.y)}`);
    } else if (cmd.type === 'lineTo') {
      parts.push(`L ${fmt(cmd.x)} ${fmt(cmd.y)}`);
    } else {
      parts.push(`Q ${fmt(cmd.cx)} ${fmt(cmd.cy)} ${fmt(cmd.x)} ${fmt(cmd.y)}`);
    }
  }
  return parts.join(' ');
}

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(3).replace(/\.?0+$/, '');
}

const BASE_STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  pointerEvents: 'none',
};

export function InkOverlay({ strokes, width, height }: InkOverlayProps) {
  const built: BuiltStrokePath[] = buildPaths(strokes);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={BASE_STYLE}
      aria-hidden="true"
    >
      {built.map((b) => (
        <path
          key={b.id}
          d={commandsToD(b.commands)}
          stroke={b.color}
          strokeWidth={b.width}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
