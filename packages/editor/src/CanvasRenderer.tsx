import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, Platform } from 'react-native';
import Constants from 'expo-constants';
// nanoid/non-secure: Hermes has no `crypto` global, so the default
// nanoid entry point (which calls crypto.getRandomValues) throws on
// native. Stroke IDs don't need cryptographic randomness — Math.random
// collision resistance is fine for a per-session ID.
import { nanoid } from 'nanoid/non-secure';
import { tokens } from '@graphite/ui';
import type { CanvasDocument, InkLayer, InkStroke, StrokePoint } from '@graphite/db';
import { LivePreviewInput } from './LivePreviewInput';
import { strokeToOutlinePath } from './inkPath';
import type { FormatCommand } from './types';

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
  /** Controls whether the text layer accepts keyboard input */
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
 *
 * Gesture model (Slice 2.5):
 *   Ink capture is gated by the manual `inputMode` toggle exposed on the
 *   toolbar. This is a deliberate step back from the automatic pencil
 *   detection that shipped in Slice 2 (build 46) — putting responder
 *   handlers on a wrapper of the WebView starved WKWebView of native
 *   touches and broke both finger text input AND Apple Pencil ink.
 *
 *   TODO(Slice 3): move automatic pencil-vs-finger detection INSIDE the
 *   iframe via DOM Pointer Events (`pointerType === 'pen'`) and stream
 *   pen coordinates out through the existing postMessage bridge. Manual
 *   toggle goes away at that point.
 */
export function CanvasRenderer({
  canvasDoc,
  width = 680,
  onInkChange,
  onTextChange,
  readOnly = false,
  inputMode = 'scroll',
  pendingCommand,
  onCommandApplied,
  onActiveFormatsChange,
  autoFocusFirst = false,
  focusKey = null,
}: CanvasRendererProps) {
  const [contentHeight, setContentHeight] = useState(600);
  const [activeStroke, setActiveStroke] = useState<InkStroke | null>(null);
  const canDraw = inputMode === 'ink' && !readOnly && !!onInkChange;

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
    // Read synthetic event fields SYNCHRONOUSLY. The setActiveStroke
    // reducer callback runs on the next render, and by that time React
    // has already returned the PressEvent to its pool — nativeEvent is
    // nulled out, and `event.nativeEvent.force` would throw
    // "Cannot read property 'force' of null". Capture the StrokePoint
    // here and close over the plain value inside the reducer.
    const point = createStrokePoint(event);
    setActiveStroke((current) => {
      if (!current) return current;
      // Object.assign instead of spread — avoids a Hermes GC crash on iOS 26
      // when shallow-copying InkStroke objects from inside a state setter.
      return Object.assign({}, current, {
        points: current.points.concat(point),
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
  }

  function handleLayout(event: { nativeEvent: { layout: { height: number } } }) {
    setContentHeight(event.nativeEvent.layout.height);
  }

  // ── Web path ─────────────────────────────────────────────────────────────
  // Skia ink layer is a no-op on web, so we skip the ScrollView + gesture
  // wrapper entirely and let the live preview component manage its own
  // height and scrolling.
  if (Platform.OS === 'web') {
    return (
      <View style={{ flex: 1, backgroundColor: tokens.bgBase }}>
        <LivePreviewInput
          value={canvasDoc.textContent.body}
          onChange={(text) => onTextChange?.(text)}
          inputMode={readOnly ? 'ink' : inputMode}
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
  // Pencil strokes visually sit above the CodeMirror-rendered text.
  //
  // Critical invariant: the ink overlay is a SIBLING of the text content,
  // not a wrapper around it. When inputMode !== 'ink' the overlay has
  // pointerEvents='none' so touches reach the WebView natively — that is
  // what lets WKWebView own finger taps for selection and keyboard focus.
  // Do NOT add responder handlers to the outer wrapper View (see b2a05a4
  // and the Slice 2 regression in 1fa3559 / build 46).
  //
  const scrollContent = (
    <ScrollView
      bounces={false}
      style={{ backgroundColor: tokens.bgBase }}
      contentContainerStyle={{ width }}
      scrollEnabled={inputMode !== 'ink'}
      keyboardShouldPersistTaps="handled"
    >
      <View style={{ width }} onLayout={handleLayout}>
        <View style={styles.contentLayer}>
          <LivePreviewInput
            value={canvasDoc.textContent.body}
            onChange={(text) => onTextChange?.(text)}
            inputMode={readOnly ? 'ink' : inputMode}
            placeholder="Start writing..."
            pendingCommand={pendingCommand}
            onCommandApplied={onCommandApplied}
            onActiveFormatsChange={onActiveFormatsChange}
            autoFocus={autoFocusFirst}
            focusKey={focusKey}
          />
        </View>

        {/* Ink overlay — three mutually exclusive mount states.
            Production regression investigation (builds 46-49) found
            that a perpetually-mounted absoluteFill View carrying
            responder handlers on top of the WebView steals touches
            from WKWebView on iOS Fabric / New Architecture, even
            when pointerEvents='none' and the responder callbacks
            return false. RCTSurfaceTouchHandler still installs a
            gesture recognizer at the View level whenever responder
            methods are attached, and that recognizer preempts
            WKWebView's internal first-responder tap routing.
            Three agents (SWE-1, SWE-2, QA) independently identified
            this as the cause of "body area black, tapping does
            nothing" on production TestFlight.
            Fix:
              1. canDraw  -> wrapper with responders AND Skia child
              2. !canDraw && strokes.length > 0  ->  pointerEvents=
                 'none' wrapper with Skia child and NO responder
                 handlers. Strokes still render visually; WebView
                 underneath keeps uncontested touch delivery.
              3. !canDraw && strokes.length === 0  ->  nothing
                 mounted at all. WebView sibling is the only thing
                 above the content layer. Matches Expo Go's tree. */}
        {canDraw ? (
          <View
            style={StyleSheet.absoluteFill}
            pointerEvents="auto"
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handleInkStart}
            onResponderMove={handleInkMove}
            onResponderRelease={finishInkStroke}
            onResponderTerminate={finishInkStroke}
            onResponderTerminationRequest={() => false}
          >
            <InkLayerView
              inkLayer={canvasDoc.inkLayer}
              width={width}
              height={contentHeight}
              activeStroke={activeStroke}
            />
          </View>
        ) : canvasDoc.inkLayer.strokes.length > 0 ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <InkLayerView
              inkLayer={canvasDoc.inkLayer}
              width={width}
              height={contentHeight}
              activeStroke={null}
            />
          </View>
        ) : null}
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
