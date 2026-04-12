import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CanvasSchemaV1 } from '@graphite/db';

// Mock expo-modules-core BEFORE importing the module under test so the lazy
// `require('expo-modules-core')` inside `graphite-pencil-kit/src/index.ts`
// resolves to our stub. Vitest hoists `vi.mock` above imports, so this is
// safe at the top of the file.
const extractStrokesNativeMock = vi.fn();
vi.mock('expo-modules-core', () => ({
  requireNativeModule: (name: string) => {
    if (name !== 'GraphitePencilKit') {
      throw new Error(`Unexpected module name: ${name}`);
    }
    return { extractStrokes: extractStrokesNativeMock };
  },
}));

// Dynamic import after the mock so the module under test picks up the stub.
async function loadModule() {
  return await import('../src/index');
}

/**
 * Shape emitted by the Swift side — matches the `serializeStroke` output in
 * GraphitePencilKitModule.swift. The TS adapter is responsible for stamping
 * `id` via nanoid and validating the full stroke via Zod.
 */
function nativeStrokeFixture(overrides: Record<string, unknown> = {}) {
  return {
    points: [
      { x: 0, y: 0, pressure: 0.5, timeOffset: 0 },
      { x: 10, y: 12, pressure: 0.8, timeOffset: 16, azimuth: 1.2, altitude: 0.7 },
    ],
    color: '#FFFFFF',
    width: 3,
    tool: 'pen',
    anchor: { type: 'absolute', x: 0, y: 0 },
    ...overrides,
  };
}

describe('graphite-pencil-kit extractStrokes adapter', () => {
  beforeEach(() => {
    extractStrokesNativeMock.mockReset();
    // Reset module cache so the adapter's lazy `nativeModuleCache` is
    // re-initialized for each test — otherwise the first test's resolution
    // (success or failure) sticks around for the rest of the file.
    vi.resetModules();
  });

  it('returns an empty array when the native side emits no strokes', async () => {
    extractStrokesNativeMock.mockResolvedValueOnce([]);
    const { extractStrokes } = await loadModule();

    const result = await extractStrokes('BASE64==');

    expect(result).toEqual([]);
    expect(extractStrokesNativeMock).toHaveBeenCalledWith('BASE64==');
  });

  it('stamps each stroke with a unique nanoid and passes Zod validation', async () => {
    extractStrokesNativeMock.mockResolvedValueOnce([
      nativeStrokeFixture(),
      nativeStrokeFixture({ color: '#F28500', tool: 'marker' }),
    ]);
    const { extractStrokes } = await loadModule();

    const result = await extractStrokes('BASE64==');

    expect(result).toHaveLength(2);
    expect(result[0].id).toBeTypeOf('string');
    expect(result[0].id.length).toBeGreaterThan(5);
    expect(result[1].id).toBeTypeOf('string');
    expect(result[0].id).not.toBe(result[1].id);

    // Belt-and-suspenders: re-validate every stroke against the schema.
    // The adapter already does this, but we want a test that breaks if the
    // adapter ever loses its validation pass.
    const parsed = CanvasSchemaV1.inkStrokeSchema.array().safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it('preserves optional azimuth/altitude on each point when the native side emits them', async () => {
    extractStrokesNativeMock.mockResolvedValueOnce([nativeStrokeFixture()]);
    const { extractStrokes } = await loadModule();

    const [stroke] = await extractStrokes('BASE64==');

    expect(stroke.points[0].azimuth).toBeUndefined();
    expect(stroke.points[0].altitude).toBeUndefined();
    expect(stroke.points[1].azimuth).toBeCloseTo(1.2);
    expect(stroke.points[1].altitude).toBeCloseTo(0.7);
  });

  it('always emits absolute-anchor strokes in v1.5 (paragraph anchors land in a later stage)', async () => {
    extractStrokesNativeMock.mockResolvedValueOnce([nativeStrokeFixture()]);
    const { extractStrokes } = await loadModule();

    const [stroke] = await extractStrokes('BASE64==');

    expect(stroke.anchor.type).toBe('absolute');
    if (stroke.anchor.type === 'absolute') {
      expect(stroke.anchor.x).toBe(0);
      expect(stroke.anchor.y).toBe(0);
    }
  });

  it('throws ZodError if the native side emits a stroke with an invalid tool', async () => {
    extractStrokesNativeMock.mockResolvedValueOnce([
      // Intentionally invalid tool for the negative test — Zod should throw.
      nativeStrokeFixture({ tool: 'spraypaint' }),
    ]);
    const { extractStrokes } = await loadModule();

    await expect(extractStrokes('BASE64==')).rejects.toThrow();
  });

  it('rejects strokes missing required fields (defense against native drift)', async () => {
    extractStrokesNativeMock.mockResolvedValueOnce([
      {
        // no color, no width, no tool, no anchor, no points
      },
    ]);
    const { extractStrokes } = await loadModule();

    await expect(extractStrokes('BASE64==')).rejects.toThrow();
  });

  it('propagates native-side errors to the caller (save path can decide to fall back)', async () => {
    extractStrokesNativeMock.mockRejectedValueOnce(new Error('InvalidBase64'));
    const { extractStrokes } = await loadModule();

    await expect(extractStrokes('not-base64')).rejects.toThrow('InvalidBase64');
  });

  it('accepts a stroke with empty points array (e.g. a zero-length tap)', async () => {
    extractStrokesNativeMock.mockResolvedValueOnce([
      nativeStrokeFixture({ points: [] }),
    ]);
    const { extractStrokes } = await loadModule();

    const [stroke] = await extractStrokes('BASE64==');
    expect(stroke.points).toEqual([]);
  });
});
