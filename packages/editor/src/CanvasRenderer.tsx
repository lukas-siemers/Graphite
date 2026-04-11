import React, { useRef, useState } from 'react';
import { View, ScrollView, StyleSheet, Platform } from 'react-native';
import Constants from 'expo-constants';
import { nanoid } from 'nanoid';
import { tokens } from '@graphite/ui';
import type { CanvasDocument, InkLayer, InkStroke, StrokePoint } from '@graphite/db';
import { LivePreviewInput } from './LivePreviewInput';
import { strokeToOutlinePath } from './inkPath';
import type { FormatCommand } from './types';

// ---------------------------------------------------------------------------
// Pointer-type detection
//
// iOS touch events include a `touchType` field that distinguishes finger
// ('direct') from Apple Pencil ('stylus'). React Native surfaces this on
// `event.nativeEvent` for both the TouchableResponder chain and the legacy
// gesture responders, but the exact shape has varied across SDKs — historical
// values have been the string 'stylus' or the numeric 2. We accept both.
// ---------------------------------------------------------------------------
const STYLUS_PALM_REJECT_MS = 500;

function isStylusEvent(event: any): boolean {
  const native = event?.nativeEvent;
  if (!native) return false;

  // Newer RN surfaces touchType directly on the nativeEvent for the primary
  // touch; older RN attaches it to individual entries in `touches`. Check
  // both so this is resilient across Expo SDK 54 and earlier runtimes.
  const direct = native.touchType;
  if (direct === 'stylus' || direct === 2) return true;

  const touches = native.touches;
  if (Array.isArray(touches) && touches.length > 0) {
    const t = touches[0];
    const touchType = t?.touchType;
    if (touchType === 'stylus' || touchType === 2) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Skia — dynamic import so the component works in Expo Go (no native module)
// ---------------------------------------------------------------------------
const isExpoGo = Constants.appOwnership === 'expo';
let SkiaCanvas: any = null;
let Path: any = null;
let Skia: any = null;
if (Platform.OS !== 'web' && !isExpoGo) {
  const skia = require('@shopify/react-native-skia');
  SkiaCanvas = skia.Canvas;
  Path = skia.Path;
  Skia = skia.Skia;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CanvasRendererProps {
  canvasDoc: CanvasDocument;
  /** Fixed column width. Defaults to 680. */
  width?: number;
  onInkChange?: (inkLayer: InkLayer) => void;
  onTextChange?: (text: string) => void;
  readOnly?: boolean;
  /**
   * Legacy prop — no longer drives ink capture. The unified canvas decides
   * per-touch based on pointer type (stylus vs finger). Accepted here only
   * so existing call sites do not crash; will be removed in a later slice.
   */
  inputMode?: 'ink' | 'scroll';
  /** Format command dispatched from the toolbar — routed to the CodeMirror host */
  pendingCommand?: FormatCommand | null;
  /** Called when the pending command has been consumed */
  onCommandApplied?: () => void;
  /** Reports which formats are active at the cursor — for toolbar highlighting */
  onActiveFormatsChange?: (formats: FormatCommand[]) => void;
  /** Auto-focus the editor — set true when entering edit mode from preview */
  autoFocusFirst?: boolean;
  /** Refocus the editor when the active note changes */
  focusKey?: string | null;
}

// ---------------------------------------------------------------------------
// Ink layer renderer — Skia paths for each stroke
// ---------------------------------------------------------------------------

interface InkLayerViewProps {
  inkLayer: InkLayer;
  width: number;
  height: number;
  activeStroke?: InkStroke | null;
}

function InkLayerView({ inkLayer, width, height, activeStroke = null }: InkLayerViewProps) {
  if (Platform.OS === 'web' || isExpoGo || !SkiaCanvas || !Path || !Skia) {
    // Skia is native-only — no ink layer on web or Expo Go
    return null;
  }

  const strokes = activeStroke
    ? inkLayer.strokes.concat(activeStroke)
    : inkLayer.strokes;

  return (
    <SkiaCanvas style={[StyleSheet.absoluteFill, { width, height }]}>
      {strokes.map((stroke) => {
        if (stroke.points.length === 0) return null;

        const pathStr = strokeToOutlinePath(stroke);
        if (!pathStr) return null;

        const skiaPath = Skia.Path.MakeFromSVGString(pathStr);
        if (!skiaPath) return null;

        // perfect-freehand returns an outline polygon — render as a fill,
        // NOT a stroke. The polygon already encodes the stroke geometry
        // (pressure-varied width, taper, caps), so a fill paint reproduces
        // the pen shape faithfully. A stroke paint would draw an outline
        // around the outline, which is wrong.
        const paint = Skia.Paint();
        paint.setColor(Skia.Color(stroke.color));
        paint.setStyle(0 /* fill */);
        paint.setAntiAlias(true);
        paint.setAlphaf(stroke.opacity);

        return <Path key={stroke.id} path={skiaPath} paint={paint} />;
      })}
    </SkiaCanvas>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Renders a CanvasDocument on a fixed-width infinite-scroll surface.
 *
 * Unified editor model (v1.5):
 *   - Text layer: a single CodeMirror 6 live-preview editor hosted in a
 *     react-native-webview (native) or <iframe> (web). Code blocks, headings,
 *     inline formatting are all rendered by CodeMirror — no React Native
 *     segment parsing, no separate <CodeBlock> component.
 *   - Ink layer: Skia strokes overlaid on native, no-op on web.
 */
export function CanvasRenderer({
  canvasDoc,
  width = 680,
  onInkChange,
  onTextChange,
  readOnly = false,
  // inputMode is accepted for backward-compat only — see prop comment above.
  inputMode: _inputMode,
  pendingCommand,
  onCommandApplied,
  onActiveFormatsChange,
  autoFocusFirst = false,
  focusKey = null,
}: CanvasRendererProps) {
  const [contentHeight, setContentHeight] = useState(600);
  const [activeStroke, setActiveStroke] = useState<InkStroke | null>(null);
  // Ink is always potentially on — the per-event pointer-type check inside
  // the responder callbacks decides whether to capture a given touch.
  const canDraw = !readOnly && !!onInkChange;
  // Timestamp of the last stylus move. Used to hold a short palm-rejection
  // window after pencil lift so stray finger touches don't drop a caret.
  const lastStylusAtRef = useRef<number>(0);

  function createStrokePoint(event: any): StrokePoint {
    const native = event.nativeEvent;
    const pressure =
      typeof native.force === 'number' && native.force > 0
        ? native.force
        : typeof native.pressure === 'number' && native.pressure > 0
          ? native.pressure
          : 0.5;
    const altitudeAngle =
      typeof native.altitudeAngle === 'number' ? native.altitudeAngle : null;
    const tilt =
      altitudeAngle !== null
        ? Math.max(0, Math.min(90, 90 - (altitudeAngle * 180) / Math.PI))
        : Math.hypot(
            typeof native.tiltX === 'number' ? native.tiltX : 0,
            typeof native.tiltY === 'number' ? native.tiltY : 0,
          );

    return {
      x: native.locationX,
      y: native.locationY,
      pressure,
      tilt,
      timestamp: Date.now(),
    };
  }

  function handleInkStart(event: any) {
    if (!canDraw) return;
    lastStylusAtRef.current = Date.now();
    setActiveStroke({
      id: nanoid(),
      points: [createStrokePoint(event)],
      // Default stroke color — grey body-text tone so ink reads as a peer
      // to typed text instead of accent chrome. See canvas-ink-ux spec 3.1.
      color: tokens.textBody,
      // perfect-freehand `size` — ballpoint-pen reference width per spec 3.2.
      width: 3.5,
      opacity: 1,
    });
  }

  function handleInkMove(event: any) {
    if (!canDraw) return;
    lastStylusAtRef.current = Date.now();
    setActiveStroke((current) => {
      if (!current) return current;
      // Object.assign instead of spread — avoids a Hermes GC crash on iOS 26
      // when shallow-copying InkStroke objects from inside a state setter.
      return Object.assign({}, current, {
        points: current.points.concat(createStrokePoint(event)),
      });
    });
  }

  function finishInkStroke() {
    if (!canDraw) {
      setActiveStroke(null);
      return;
    }

    setActiveStroke((current) => {
      if (!current || current.points.length === 0) {
        return null;
      }

      const updatedLayer: InkLayer = {
        strokes: canvasDoc.inkLayer.strokes.concat(current),
      };
      onInkChange?.(updatedLayer);
      return null;
    });
    // Keep the palm-rejection window alive briefly after pencil lift.
    lastStylusAtRef.current = Date.now();
  }

  function handleLayout(event: { nativeEvent: { layout: { height: number } } }) {
    setContentHeight(event.nativeEvent.layout.height);
  }

  // ── Web path ─────────────────────────────────────────────────────────────
  // Skia ink layer is a no-op on web, so we skip the ScrollView + gesture
  // wrapper entirely and let the live preview component manage its own
  // height and scrolling. The text layer is always editable unless the
  // whole canvas is readOnly — there is no ink gate on web.
  if (Platform.OS === 'web') {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.bgBase }}>
        <LivePreviewInput
          value={canvasDoc.textContent.body}
          onChange={(text) => onTextChange?.(text)}
          inputMode={readOnly ? 'ink' : 'scroll'}
          placeholder="Start writing..."
          pendingCommand={pendingCommand}
          onCommandApplied={onCommandApplied}
          onActiveFormatsChange={onActiveFormatsChange}
          autoFocus={autoFocusFirst}
          focusKey={focusKey}
        />
      </View>
    );
  }

  // ── Native path ──────────────────────────────────────────────────────────
  // Same unified editor, plus the Skia ink layer rendered on top so Apple
  // Pencil strokes visually sit above the CodeMirror-rendered text. The
  // ScrollView is always scroll-enabled; finger touches fall through the
  // ink responder to scroll/edit text, stylus touches are captured by the
  // ink layer and commit a stroke on pencil lift.
  //
  // Responder gating (per canvas-ink-ux spec section 2):
  //   - stylus touch  -> capture, start/continue an ink stroke
  //   - finger touch  -> return false, event falls through to WebView/ScrollView
  //   - finger touch within 500ms of the last stylus move -> also rejected
  //     as palm contact (see spec case 12)
  //
  function shouldSetInkResponder(event: any): boolean {
    if (!canDraw) return false;
    if (isStylusEvent(event)) return true;
    // Inside the stylus palm-rejection window — swallow finger touches so
    // they do not reach the text layer either. The responder callback
    // returning true then releasing without a stroke accomplishes the swallow.
    if (Date.now() - lastStylusAtRef.current < STYLUS_PALM_REJECT_MS) {
      return true;
    }
    return false;
  }

  function handleInkGrant(event: any) {
    // During the palm-rejection window a non-stylus touch may have been
    // captured purely to swallow it — in that case do not start a stroke.
    if (!isStylusEvent(event)) return;
    handleInkStart(event);
  }

  function handleInkResponderMove(event: any) {
    if (!activeStroke) return;
    handleInkMove(event);
  }

  function handleInkResponderEnd() {
    if (!activeStroke) {
      // Was a swallowed finger touch during palm-rejection; nothing to commit.
      return;
    }
    finishInkStroke();
  }

  const scrollContent = (
    <ScrollView
      bounces={false}
      style={{ backgroundColor: tokens.bgBase }}
      contentContainerStyle={{ width }}
      keyboardShouldPersistTaps="handled"
    >
      {/* Outer wrapper owns the responder chain so it can intercept
          stylus touches in the CAPTURE phase before the WebView hit-test
          runs. Finger touches fall through to descendants normally. */}
      <View
        style={{ width }}
        onLayout={handleLayout}
        onStartShouldSetResponderCapture={shouldSetInkResponder}
        onMoveShouldSetResponderCapture={shouldSetInkResponder}
        onResponderGrant={handleInkGrant}
        onResponderMove={handleInkResponderMove}
        onResponderRelease={handleInkResponderEnd}
        onResponderTerminate={handleInkResponderEnd}
        onResponderTerminationRequest={() => false}
      >
        <View style={styles.contentLayer}>
          <LivePreviewInput
            value={canvasDoc.textContent.body}
            onChange={(text) => onTextChange?.(text)}
            inputMode={readOnly ? 'ink' : 'scroll'}
            placeholder="Start writing..."
            pendingCommand={pendingCommand}
            onCommandApplied={onCommandApplied}
            onActiveFormatsChange={onActiveFormatsChange}
            autoFocus={autoFocusFirst}
            focusKey={focusKey}
          />
        </View>

        {/* Ink layer — absolutely positioned ON TOP of the content but
            pointer-transparent (pointerEvents='none'). Touches flow to
            the outer wrapper's CAPTURE handlers above, which decide
            stylus-vs-finger. The ink View itself is purely for Skia
            rendering. */}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <InkLayerView
            inkLayer={canvasDoc.inkLayer}
            width={width}
            height={contentHeight}
            activeStroke={activeStroke}
          />
        </View>
      </View>
    </ScrollView>
  );

  return (
    <View style={{ flex: 1 }}>
      {scrollContent}
    </View>
  );
}

const styles = StyleSheet.create({
  contentLayer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 48,
  },
});
