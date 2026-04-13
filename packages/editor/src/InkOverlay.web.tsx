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

export function InkOverlay({
  strokes,
  width,
  height,
  pointerEvents = 'none',
  onNewStroke,
}: InkOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef<SpatialInkStroke | null>(null);

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
      const s: SpatialInkStroke = {
        id: nanoid(),
        color: '#FFFFFF',
        width: 2,
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
    [pointToCanvas, pointerEvents, redraw],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
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
    [pointToCanvas, redraw],
  );

  const handlePointerUp = useCallback(() => {
    const s = activeRef.current;
    if (!s) return;
    activeRef.current = null;
    onNewStroke?.(s);
    redraw();
  }, [onNewStroke, redraw]);

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
