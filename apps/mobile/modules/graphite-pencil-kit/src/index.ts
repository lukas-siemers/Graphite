import { requireNativeModule } from 'expo-modules-core';
import { nanoid } from 'nanoid/non-secure';
import { CanvasSchemaV1 } from '@graphite/db';

/**
 * Shape returned by the native `extractStrokes` call. Intentionally loose
 * (`unknown` fields) — we validate every field via
 * `CanvasSchemaV1.inkStrokeSchema` before handing anything back to the rest
 * of the app.
 */
interface NativeGraphitePencilKit {
  extractStrokes(base64: string): Promise<Array<Record<string, unknown>>>;
}

/**
 * Lazy native module handle.
 *
 * Resolution happens on first call to {@link extractStrokes}, not at import
 * time. On iOS the module is always present; on web / Android / Vitest the
 * require can throw, and we want consumers to get a thrown Error from the
 * call site rather than a module-load crash.
 *
 * The ES import of `requireNativeModule` at the top of this file is safe
 * because `expo-modules-core` is a transitive dependency of the mobile app
 * (`expo` pulls it in). Consumers outside the mobile app should not import
 * this module.
 */
let nativeModuleCache: NativeGraphitePencilKit | null | undefined;

function loadNativeModule(): NativeGraphitePencilKit | null {
  if (nativeModuleCache !== undefined) {
    return nativeModuleCache;
  }
  try {
    nativeModuleCache = requireNativeModule<NativeGraphitePencilKit>(
      'GraphitePencilKit',
    );
  } catch (_err) {
    nativeModuleCache = null;
  }
  return nativeModuleCache;
}

/**
 * Returns true iff the native module is registered in this runtime. Safe to
 * call on any platform — it won't throw.
 */
export function isExtractStrokesSupported(): boolean {
  return loadNativeModule() !== null;
}

/**
 * Convert a PencilKit `PKDrawing.dataRepresentation()` base64 blob into the
 * Stage-2 cross-platform stroke representation used by Graphite's canvas
 * document (`canvas_json.inkLayer.strokes`).
 *
 * The native side (`GraphitePencilKitModule.swift`) does all the heavy
 * lifting — walking `PKStroke.path`, mapping `PKInkType` to the schema enum,
 * converting `UIColor` to hex, etc. This adapter:
 *
 *   1. Calls the native method.
 *   2. Stamps each stroke with a nanoid-generated `id` (the task spec
 *      requires nanoid on the JS side for consistency with the rest of
 *      Graphite's ID generation).
 *   3. Validates the complete stroke array via
 *      `CanvasSchemaV1.inkStrokeSchema.array().parse(...)`. If the native
 *      side ever drifts from the schema, this throws a `ZodError` rather
 *      than letting malformed data reach SQLite.
 *
 * Error behavior: any native failure (bad base64, unregistered module,
 * invalid PKDrawing) surfaces as a thrown Error. The caller in
 * `Editor.tsx#handleDrawingChange` catches these and falls back to writing
 * the raw blob with `strokes: []` so the save path never crashes.
 *
 * @param pkDrawingBase64 — raw output of
 *   `react-native-pencil-kit`'s `getBase64Data()`.
 */
export async function extractStrokes(
  pkDrawingBase64: string,
): Promise<Stroke[]> {
  const native = loadNativeModule();
  if (!native) {
    throw new Error(
      'GraphitePencilKit native module is not registered in this runtime. ' +
        'Extraction only works on iOS dev-client / TestFlight builds.',
    );
  }

  const rawStrokes = await native.extractStrokes(pkDrawingBase64);

  // Stamp IDs in JS so nanoid stays the single ID source of truth across the
  // codebase (see CLAUDE.md "Phase 1 key rules"). IDs are generated after
  // the native call so the Swift side stays free of nanoid dependencies.
  const withIds = rawStrokes.map((stroke) => ({
    ...stroke,
    id: nanoid(),
  }));

  // Zod-validate. Fail loud on schema drift — silent coercion would let bad
  // data slip into SQLite where the desktop renderer would trip on it.
  return CanvasSchemaV1.inkStrokeSchema.array().parse(withIds);
}

/**
 * Re-export of the validated stroke type so consumers (Editor.tsx) can use
 * `extractStrokes`'s return value without reaching into `@graphite/db`
 * directly.
 */
export type Stroke = CanvasSchemaV1.InkStroke;
