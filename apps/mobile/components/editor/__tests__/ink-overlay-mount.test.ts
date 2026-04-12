/**
 * Unit tests for the pure `shouldMountInkOverlay` predicate that gates
 * the Skia ink overlay mount in `Editor.tsx`. Testing the predicate in
 * isolation avoids mounting the full editor tree — which would drag in
 * `@shopify/react-native-skia`, `react-native-pencil-kit`, vector icons,
 * and assorted native surfaces that a Node Vitest environment cannot
 * resolve.
 *
 * These assertions are load-bearing for two CLAUDE.md rules:
 *   - iOS production startup trap: Skia must NOT be pulled into the
 *     editor route load path on fresh notes. Regression = black-screen
 *     TestFlight.
 *   - project_stroke_anchor_schema: the overlay skips when there's
 *     nothing renderable; the caller is the first guard.
 */
import { describe, it, expect } from 'vitest';
import { shouldMountInkOverlay } from '../ink-overlay-mount';

const BASE = {
  drawMode: false,
  strokeCount: 1,
  layoutWidth: 1024,
  layoutHeight: 800,
  platform: 'ios',
};

describe('shouldMountInkOverlay', () => {
  it('mounts when iPad + not drawing + strokes present + layout measured', () => {
    expect(shouldMountInkOverlay(BASE)).toBe(true);
  });

  // ----- strokes guard -----

  it('does NOT mount when strokes.length === 0 (fresh note, no ink yet)', () => {
    expect(shouldMountInkOverlay({ ...BASE, strokeCount: 0 })).toBe(false);
  });

  it('does NOT mount when strokes count is negative (defensive)', () => {
    expect(shouldMountInkOverlay({ ...BASE, strokeCount: -1 })).toBe(false);
  });

  // ----- drawMode guard -----

  it('does NOT mount when drawMode is true (PencilKit owns the surface)', () => {
    expect(shouldMountInkOverlay({ ...BASE, drawMode: true })).toBe(false);
  });

  it('does NOT mount when drawMode is true even with strokes present', () => {
    expect(
      shouldMountInkOverlay({ ...BASE, drawMode: true, strokeCount: 99 }),
    ).toBe(false);
  });

  // ----- layout guard -----

  it('does NOT mount before the first onLayout callback (zero width)', () => {
    expect(shouldMountInkOverlay({ ...BASE, layoutWidth: 0 })).toBe(false);
  });

  it('does NOT mount before the first onLayout callback (zero height)', () => {
    expect(shouldMountInkOverlay({ ...BASE, layoutHeight: 0 })).toBe(false);
  });

  // ----- platform guard -----

  it('does NOT mount on Android (not a v1.5 target)', () => {
    expect(shouldMountInkOverlay({ ...BASE, platform: 'android' })).toBe(false);
  });

  it('mounts on web / Electron — Stage 4 SVG renderer picks up .web.tsx', () => {
    // Updated in Stage 4: the web bundle now ships a real SVG ink
    // renderer (`InkOverlay.web.tsx`), not a stub. The mount predicate
    // must allow it so iPad scribbles are visible on the desktop app.
    // Skia is NOT pulled in on web — Metro/webpack resolve the `.web`
    // variant ahead of `.tsx`, so `@shopify/react-native-skia` never
    // enters the desktop bundle.
    expect(shouldMountInkOverlay({ ...BASE, platform: 'web' })).toBe(true);
  });
});
