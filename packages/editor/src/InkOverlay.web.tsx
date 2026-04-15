/**
 * InkOverlay (web) — renders SpatialInkStroke[] on an HTML <canvas>.
 *
 * Same props and positioning model as the native variant: the parent sizes
 * the overlay to (canvasWidth, totalCanvasHeight) and places it inside scroll
 * content. When `pointerEvents === 'none'` the overlay passes pointer events
 * through to the text layer; when `'auto'` it captures pointer input via
 * PointerEvents (pressure is available through the Pointer Events spec on
 * supporting stylus hardware).
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { nanoid } from 'nanoid/non-secure';
import type { SpatialInkStroke, StrokePoint } from './ink-types';

export interface InkOverlayProps {
  strokes: SpatialInkStroke[];
  width: number;
  height: number;
  pointerEvents?: 'none' | 'auto';
  onNewStroke?: (stroke: SpatialInkStroke) => void;
  /** Build 118: web parity with native. Not yet wired on web — see below. */
  onEraseStrokes?: (ids: string[]) => void;
  /** Build 115 diagnostic (no-op on web). */
  onResponderGrantDiagnostic?: () => void;
  /** Build 117: pen stroke color. */
  strokeColor?: string;
  /** Build 117: pen stroke width. */
  strokeWidth?: number;
  /** Build 118: 'pen' (default) appends strokes, 'eraser' deletes. */
  tool?: 'pen' | 'eraser';
}

function averagePressure(points: StrokePoint[]): number {
  if (points.length === 0) return 0.5;
  let sum = 0;
  for (const p of points) sum += p.pressure;
  return sum / points.length;
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: SpatialInkStroke) {
  const { points } = stroke;
  if (points.length === 0) return;
  const avg = averagePressure(points);
  ctx.save();
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = stroke.width * (0.5 + 0.5 * avg);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = stroke.opacity;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

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

export function InkOverlay({
  strokes,
  width,
  height,
  pointerEvents = 'none',
  onNewStroke,
  onEraseStrokes,
  strokeColor = '#FFFFFF',
  strokeWidth = 2,
  tool = 'pen',
}: InkOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef<SpatialInkStroke | null>(null);
  const erasedIdsRef = useRef<Set<string>>(new Set());

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokes) drawStroke(ctx, s);
    if (activeRef.current) drawStroke(ctx, activeRef.current);
  }, [strokes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Match pixel size to logical size so stroke math stays in canvas coords.
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    redraw();
  }, [width, height, redraw]);

  const pointToCanvas = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * canvas.width,
        y: ((e.clientY - rect.top) / rect.height) * canvas.height,
      };
    },
    [],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (pointerEvents === 'none') return;
      const { x, y } = pointToCanvas(e);
      if (tool === 'eraser') {
        erasedIdsRef.current = new Set();
        for (const s of strokes) {
          if (strokeHit(s, x, y)) erasedIdsRef.current.add(s.id);
        }
        (e.target as Element).setPointerCapture?.(e.pointerId);
        return;
      }
      const s: SpatialInkStroke = {
        id: nanoid(),
        color: strokeColor,
        width: strokeWidth,
        opacity: 1,
        points: [
          {
            x,
            y,
            pressure: e.pressure || 0.5,
            tilt: e.tiltX ?? 0,
            timestamp: Date.now(),
          },
        ],
      };
      activeRef.current = s;
      (e.target as Element).setPointerCapture?.(e.pointerId);
      redraw();
    },
    [pointToCanvas, pointerEvents, redraw, strokeColor, strokeWidth, tool, strokes],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (tool === 'eraser') {
        const { x, y } = pointToCanvas(e);
        for (const s of strokes) {
          if (!erasedIdsRef.current.has(s.id) && strokeHit(s, x, y)) {
            erasedIdsRef.current.add(s.id);
          }
        }
        return;
      }
      const s = activeRef.current;
      if (!s) return;
      const { x, y } = pointToCanvas(e);
      s.points.push({
        x,
        y,
        pressure: e.pressure || 0.5,
        tilt: e.tiltX ?? 0,
        timestamp: Date.now(),
      });
      redraw();
    },
    [pointToCanvas, redraw, tool, strokes],
  );

  const handlePointerUp = useCallback(() => {
    if (tool === 'eraser') {
      const ids = Array.from(erasedIdsRef.current);
      erasedIdsRef.current = new Set();
      if (ids.length > 0) onEraseStrokes?.(ids);
      return;
    }
    const s = activeRef.current;
    if (!s) return;
    activeRef.current = null;
    onNewStroke?.(s);
    redraw();
  }, [onNewStroke, onEraseStrokes, redraw, tool]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height,
        pointerEvents,
        touchAction: pointerEvents === 'auto' ? 'none' : 'auto',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  );
}
