import React, { useRef, useMemo } from 'react';
import { View, ScrollView, StyleSheet, Platform } from 'react-native';

// Gesture handler is native-only — on web the ink layer is a no-op anyway
// (Skia is stubbed) so we skip it entirely to avoid DOM style errors.
let Gesture: any = { Pan: () => ({ runOnJS: () => ({ enabled: () => ({ onStart: () => ({ onUpdate: () => ({ onEnd: () => ({}) }) }) }) }) }) };
let GestureDetector: any = ({ children }: { children: React.ReactNode }) => <>{children}</>;
let GestureHandlerRootView: any = ({ children, style }: { children: React.ReactNode; style?: any }) => (
  <View style={style}>{children}</View>
);

if (Platform.OS !== 'web') {
  const gh = require('react-native-gesture-handler');
  Gesture = gh.Gesture;
  GestureDetector = gh.GestureDetector;
  GestureHandlerRootView = gh.GestureHandlerRootView;
}
import Constants from 'expo-constants';
import { nanoid } from 'nanoid';
import { tokens } from '@graphite/ui';
import type { CanvasDocument, InkLayer, InkStroke, StrokePoint } from '@graphite/db';
import { CanvasTextInput } from './CanvasTextInput';
import { CodeBlock } from './CodeBlock';

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
}

// ---------------------------------------------------------------------------
// Helpers — fenced code block parser
// ---------------------------------------------------------------------------

interface TextSegment {
  type: 'text';
  content: string;
}

interface CodeSegment {
  type: 'code';
  language: string;
  content: string;
}

type BodySegment = TextSegment | CodeSegment;

/**
 * Splits a markdown body string into alternating text and fenced-code
 * segments. Handles ``` fences with an optional language identifier.
 */
function parseBodySegments(body: string): BodySegment[] {
  const segments: BodySegment[] = [];
  // Regex matches ``` optionally followed by a language tag, captures content
  // until the closing ```. Non-greedy so nested fences are handled correctly.
  const fenceRe = /```([^\n]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRe.exec(body)) !== null) {
    // Text before this code block
    const before = body.slice(lastIndex, match.index);
    if (before.length > 0) {
      segments.push({ type: 'text', content: before });
    }
    segments.push({
      type: 'code',
      language: (match[1] ?? '').trim(),
      content: match[2] ?? '',
    });
    lastIndex = match.index + match[0].length;
  }

  // Remaining text after the last code block
  const tail = body.slice(lastIndex);
  if (tail.length > 0) {
    segments.push({ type: 'text', content: tail });
  }

  // Guarantee at least one segment so the editor is always focusable
  if (segments.length === 0) {
    segments.push({ type: 'text', content: '' });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Ink layer renderer — Skia paths for each stroke
// ---------------------------------------------------------------------------

interface InkLayerViewProps {
  inkLayer: InkLayer;
  /** Must match the ScrollView content width */
  width: number;
  /** Must match the ScrollView content height */
  height: number;
}

function InkLayerView({ inkLayer, width, height }: InkLayerViewProps) {
  if (Platform.OS === 'web' || isExpoGo || !SkiaCanvas || !Path || !Skia) {
    // Skia is native-only — no ink layer on web or Expo Go
    return null;
  }

  return (
    <SkiaCanvas
      style={[StyleSheet.absoluteFill, { width, height }]}
      // Pointer events none so the content layer on top captures all touches
    >
      {inkLayer.strokes.map((stroke) => {
        if (stroke.points.length < 2) return null;

        // Build an SVG path string from the stroke points.
        // At each segment we scale the paint width by the average pressure of
        // the two endpoints — this approximates pressure-sensitive rendering
        // without per-segment Path objects (which would be expensive).
        const svgParts: string[] = [];
        const { x: x0, y: y0 } = stroke.points[0];
        svgParts.push(`M ${x0} ${y0}`);
        for (let i = 1; i < stroke.points.length; i++) {
          const { x, y } = stroke.points[i];
          svgParts.push(`L ${x} ${y}`);
        }
        const pathStr = svgParts.join(' ');

        // Average pressure across all points for a single-pass approximation
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

        return (
          <Path
            key={stroke.id}
            path={pathStr}
            paint={paint}
          />
        );
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
 * Two layers:
 *   1. Ink (react-native-skia) — absolutely positioned behind content
 *   2. Content (text + code blocks) — on top, receives touch events
 */
export function CanvasRenderer({
  canvasDoc,
  width = 680,
  onInkChange,
  onTextChange,
  readOnly = false,
  inputMode = 'scroll',
}: CanvasRendererProps) {
  const scrollRef = useRef<ScrollView>(null);
  const contentHeightRef = useRef<number>(600);

  // Active stroke being drawn — accumulated between pan start/change/end
  const activeStrokeRef = useRef<InkStroke | null>(null);

  /**
   * PanGesture captures Apple Pencil / finger strokes when inputMode === 'ink'.
   * gesture.nativeEvent.force  → pressure (iOS, 0–1; undefined on Android/web)
   * gesture.nativeEvent.altitudeAngle is not exposed by RNGH — tilt defaults to 0.
   */
  const inkGesture = Gesture.Pan()
    .runOnJS(true)
    .enabled(inputMode === 'ink' && !readOnly && !!onInkChange)
    .onStart((e) => {
      if (!onInkChange) return;
      const pressure: number = typeof (e as any).force === 'number'
        ? (e as any).force
        : 0.5;
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
    .onUpdate((e) => {
      if (!activeStrokeRef.current || !onInkChange) return;
      const pressure: number = typeof (e as any).force === 'number'
        ? (e as any).force
        : 0.5;
      const point: StrokePoint = {
        x: e.x,
        y: e.y,
        pressure,
        tilt: 0,
        timestamp: Date.now(),
      };
      // Mutate ref directly — avoids object/array spread in the hot gesture path
      // which can trigger HadesGC race on iOS 26 with Hermes.
      activeStrokeRef.current.points.push(point);
    })
    .onEnd(() => {
      if (!activeStrokeRef.current || !onInkChange) return;
      const completed = activeStrokeRef.current;
      activeStrokeRef.current = null;
      // Use concat to avoid spread initializer (Hermes GC safety)
      const updatedLayer: InkLayer = {
        strokes: canvasDoc.inkLayer.strokes.concat(completed),
      };
      onInkChange(updatedLayer);
    });

  const segments = useMemo(
    () => parseBodySegments(canvasDoc.textContent.body),
    [canvasDoc.textContent.body],
  );

  // Current string value for each segment position (text segments only).
  // Rebuilt each render from the segments so it always reflects the latest doc.
  const currentTextValues: string[] = segments.map((seg) =>
    seg.type === 'text' ? seg.content : '',
  );

  function handleSegmentChange(segIndex: number, newText: string) {
    if (!onTextChange) return;

    // Rebuild the full body by replacing this segment's text value and
    // re-interleaving with the code block content.
    const updatedValues = currentTextValues.map((v, i) =>
      i === segIndex ? newText : v,
    );

    let body = '';
    let textIdx = 0;
    for (const seg of segments) {
      if (seg.type === 'text') {
        body += updatedValues[textIdx];
        textIdx += 1;
      } else {
        const fence = seg.language ? `\`\`\`${seg.language}\n` : '```\n';
        body += `${fence}${seg.content}\`\`\``;
      }
    }

    onTextChange(body);
  }

  function handleLayout(event: { nativeEvent: { layout: { height: number } } }) {
    contentHeightRef.current = event.nativeEvent.layout.height;
  }

  let textValueIndex = 0;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <GestureDetector gesture={inkGesture}>
        <ScrollView
          ref={scrollRef}
          bounces={false}
          style={{ backgroundColor: tokens.bgBase }}
          contentContainerStyle={{ width }}
          scrollEnabled={inputMode !== 'ink'}
        >
          <View
            style={{ width }}
            onLayout={handleLayout}
          >
            {/* Ink layer — absolutely positioned behind everything */}
            <InkLayerView
              inkLayer={canvasDoc.inkLayer}
              width={width}
              height={contentHeightRef.current}
            />

            {/* Content layer — text segments and code blocks */}
            <View style={styles.contentLayer}>
              {segments.map((seg, idx) => {
                if (seg.type === 'code') {
                  return (
                    <CodeBlock
                      key={`code-${idx}`}
                      language={seg.language}
                      code={seg.content}
                    />
                  );
                }

                // Text segment
                const segTextIndex = textValueIndex;
                textValueIndex += 1;
                return (
                  <CanvasTextInput
                    key={`text-${idx}`}
                    value={seg.content}
                    onChange={(text) => handleSegmentChange(segTextIndex, text)}
                    inputMode={readOnly ? 'ink' : inputMode}
                    placeholder={idx === 0 ? 'Start writing...' : undefined}
                  />
                );
              })}
            </View>
          </View>
        </ScrollView>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  contentLayer: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 48,
  },
});
