import React, { useRef } from 'react';
import { View, ScrollView, StyleSheet, Platform } from 'react-native';

// Gesture handler is native-only — on web the ink layer is a no-op anyway
// (Skia is stubbed) so we skip it entirely to avoid DOM style errors.
let Gesture: any = { Pan: () => ({ runOnJS: () => ({ enabled: () => ({ onStart: () => ({ onUpdate: () => ({ onEnd: () => ({}) }) }) }) }) }) };
let GestureDetector: any = ({ children }: { children: React.ReactNode }) => <>{children}</>;
if (Platform.OS !== 'web') {
  const gh = require('react-native-gesture-handler');
  Gesture = gh.Gesture;
  GestureDetector = gh.GestureDetector;
}
import Constants from 'expo-constants';
import { nanoid } from 'nanoid';
import { tokens } from '@graphite/ui';
import type { CanvasDocument, InkLayer, InkStroke, StrokePoint } from '@graphite/db';
import { LivePreviewInput } from './LivePreviewInput';
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
}

// ---------------------------------------------------------------------------
// Ink layer renderer — Skia paths for each stroke
// ---------------------------------------------------------------------------

interface InkLayerViewProps {
  inkLayer: InkLayer;
  width: number;
  height: number;
}

function InkLayerView({ inkLayer, width, height }: InkLayerViewProps) {
  if (Platform.OS === 'web' || isExpoGo || !SkiaCanvas || !Path || !Skia) {
    // Skia is native-only — no ink layer on web or Expo Go
    return null;
  }

  return (
    <SkiaCanvas style={[StyleSheet.absoluteFill, { width, height }]}>
      {inkLayer.strokes.map((stroke) => {
        if (stroke.points.length < 2) return null;

        const svgParts: string[] = [];
        const { x: x0, y: y0 } = stroke.points[0];
        svgParts.push(`M ${x0} ${y0}`);
        for (let i = 1; i < stroke.points.length; i++) {
          const { x, y } = stroke.points[i];
          svgParts.push(`L ${x} ${y}`);
        }
        const pathStr = svgParts.join(' ');

        const avgPressure =
          stroke.points.reduce((sum, p) => sum + p.pressure, 0) /
          stroke.points.length;
        const paintWidth = stroke.width * Math.max(0.3, avgPressure);

        const paint = Skia.Paint();
        paint.setColor(Skia.Color(stroke.color));
        paint.setStrokeWidth(paintWidth);
        paint.setStyle(1 /* stroke */);
        paint.setAntiAlias(true);
        paint.setStrokeCap(1 /* round */);
        paint.setStrokeJoin(1 /* round */);
        paint.setAlphaf(stroke.opacity);

        return <Path key={stroke.id} path={pathStr} paint={paint} />;
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
  inputMode = 'scroll',
  pendingCommand,
  onCommandApplied,
  onActiveFormatsChange,
  autoFocusFirst = false,
}: CanvasRendererProps) {
  const scrollRef = useRef<ScrollView>(null);
  const contentHeightRef = useRef<number>(600);

  // Active stroke being drawn — accumulated between pan start/change/end
  const activeStrokeRef = useRef<InkStroke | null>(null);

  /**
   * PanGesture captures Apple Pencil / finger strokes when inputMode === 'ink'.
   */
  const inkGesture = Gesture.Pan()
    .runOnJS(true)
    .enabled(inputMode === 'ink' && !readOnly && !!onInkChange)
    .onStart((e: any) => {
      if (!onInkChange) return;
      const pressure: number = typeof e.force === 'number' ? e.force : 0.5;
      const point: StrokePoint = {
        x: e.x,
        y: e.y,
        pressure,
        tilt: 0,
        timestamp: Date.now(),
      };
      activeStrokeRef.current = {
        id: nanoid(),
        points: [point],
        color: tokens.textPrimary,
        width: 2,
        opacity: 1.0,
      };
    })
    .onUpdate((e: any) => {
      if (!activeStrokeRef.current || !onInkChange) return;
      const pressure: number = typeof e.force === 'number' ? e.force : 0.5;
      const point: StrokePoint = {
        x: e.x,
        y: e.y,
        pressure,
        tilt: 0,
        timestamp: Date.now(),
      };
      activeStrokeRef.current.points.push(point);
    })
    .onEnd(() => {
      if (!activeStrokeRef.current || !onInkChange) return;
      const completed = activeStrokeRef.current;
      activeStrokeRef.current = null;
      const updatedLayer: InkLayer = {
        strokes: canvasDoc.inkLayer.strokes.concat(completed),
      };
      onInkChange(updatedLayer);
    });

  function handleLayout(event: { nativeEvent: { layout: { height: number } } }) {
    contentHeightRef.current = event.nativeEvent.layout.height;
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
        />
      </View>
    );
  }

  // ── Native path ──────────────────────────────────────────────────────────
  // Same unified editor, plus the Skia ink layer rendered on top so Apple
  // Pencil strokes visually sit above the CodeMirror-rendered text.
  //
  // GestureDetector installs a native UIPanGestureRecognizer even when
  // disabled, which competes with the WebView's internal UIScrollView and
  // prevents it from becoming first responder on tap. We only wrap with
  // GestureDetector in ink mode; in scroll mode the gesture handler is
  // absent so the WebView receives all touches cleanly.
  //
  // GestureHandlerRootView is already provided by Expo Router at the app
  // root — nesting a second one can break touch delivery on iOS, so we
  // use a plain View wrapper here instead.
  const scrollContent = (
    <ScrollView
      ref={scrollRef}
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
          />
        </View>

        {/* Ink layer — absolutely positioned ON TOP of the content.
            Pointer events are disabled unless we're in ink mode so
            keyboard text entry still reaches the WebView underneath. */}
        <View
          style={StyleSheet.absoluteFill}
          pointerEvents={inputMode === 'ink' ? 'auto' : 'none'}
        >
          <InkLayerView
            inkLayer={canvasDoc.inkLayer}
            width={width}
            height={contentHeightRef.current}
          />
        </View>
      </View>
    </ScrollView>
  );

  if (inputMode === 'ink') {
    // GestureHandlerRootView is already provided by Expo Router at the app
    // root. Nesting a second one crashes on iOS (duplicate gesture handler
    // registry). Use a plain View wrapper instead.
    return (
      <View style={{ flex: 1 }}>
        <GestureDetector gesture={inkGesture}>
          {scrollContent}
        </GestureDetector>
      </View>
    );
  }

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
