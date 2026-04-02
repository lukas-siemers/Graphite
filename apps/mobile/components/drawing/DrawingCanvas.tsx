import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
// Skia requires a native build — not available in Expo Go.
// Wrap in try/catch so the module loads safely in Expo Go.
let Canvas: any = null;
let Path: any = null;
let Skia: any = null;
let skiaAvailable = false;
try {
  const skia = require('@shopify/react-native-skia');
  Canvas = skia.Canvas;
  Path = skia.Path;
  Skia = skia.Skia;
  skiaAvailable = true;
} catch {
  // Running in Expo Go — drawing canvas will show a placeholder
}
import {
  Gesture,
  GestureDetector,
} from 'react-native-gesture-handler';
import { nanoid } from 'nanoid/non-secure';
import { tokens } from '@graphite/ui';
import type { Point, Stroke } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PALETTE: string[] = ['#FFFFFF', '#F28500', '#FF6B6B', '#69D2E7'];
const SIZE_OPTIONS: { label: string; width: number }[] = [
  { label: 'S', width: 2 },
  { label: 'M', width: 4 },
  { label: 'L', width: 8 },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DrawingCanvasProps {
  noteId: string;
  onClose: () => void;
  initialStrokes?: Stroke[];
  onSave: (strokes: Stroke[]) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an SVG path string from an array of points.
 * Returns null when there are fewer than 2 points (nothing to draw).
 */
function buildPathString(points: Point[]): string | null {
  if (points.length === 0) return null;
  if (points.length === 1) {
    // Render a tiny line so single dots are visible
    const { x, y } = points[0];
    return `M ${x} ${y} L ${x + 0.1} ${y + 0.1}`;
  }
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ');
}

/**
 * Average pressure over a stroke's points; falls back to 0.5.
 */
function avgPressure(points: Point[]): number {
  if (points.length === 0) return 0.5;
  const sum = points.reduce((acc, p) => acc + p.pressure, 0);
  return sum / points.length;
}

/**
 * Compute effective stroke width using pressure.
 * formula: baseWidth * (avgPressure * 1.5 + 0.5)
 */
function effectiveWidth(stroke: Stroke): number {
  return stroke.width * (avgPressure(stroke.points) * 1.5 + 0.5);
}

// ---------------------------------------------------------------------------
// StrokePath — renders a single stroke as a <Path> in Skia
// ---------------------------------------------------------------------------

interface StrokePathProps {
  stroke: Stroke;
}

function StrokePath({ stroke }: StrokePathProps) {
  const pathStr = buildPathString(stroke.points);
  if (!pathStr) return null;

  const skPath = Skia.Path.MakeFromSVGString(pathStr);
  if (!skPath) return null;

  const color =
    stroke.tool === 'eraser' ? tokens.bgBase : stroke.color;
  const width = effectiveWidth(stroke);

  return (
    <Path
      path={skPath}
      color={color}
      style="stroke"
      strokeWidth={width}
      strokeCap="round"
      strokeJoin="round"
    />
  );
}

// ---------------------------------------------------------------------------
// DrawingCanvas
// ---------------------------------------------------------------------------

export default function DrawingCanvas({
  initialStrokes = [],
  onSave,
  onClose,
}: DrawingCanvasProps) {
  if (!skiaAvailable) {
    return (
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(19,19,19,0.97)', alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: tokens.textMuted, fontSize: 14, textAlign: 'center', paddingHorizontal: 32 }}>
          Drawing canvas requires a native build.{'\n'}Use expo run:ios to enable Apple Pencil support.
        </Text>
        <Pressable onPress={onClose} style={{ marginTop: 24, paddingHorizontal: 24, paddingVertical: 10, backgroundColor: tokens.bgHover }}>
          <Text style={{ color: tokens.accent, fontWeight: '600', fontSize: 14 }}>Close</Text>
        </Pressable>
      </View>
    );
  }
  const insets = useSafeAreaInsets();

  // ---- drawing state ----
  const [strokes, setStrokes] = useState<Stroke[]>(initialStrokes);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);

  // ---- tool state ----
  const [activeTool, setActiveTool] = useState<'pen' | 'eraser'>('pen');
  const [activeColor, setActiveColor] = useState<string>(PALETTE[0]);
  const [activeWidth, setActiveWidth] = useState<number>(4);

  // ---- gesture ----
  const panGesture = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((event) => {
      const newStroke: Stroke = {
        id: nanoid(),
        tool: activeTool,
        color: activeColor,
        width: activeWidth,
        points: [
          {
            x: event.x,
            y: event.y,
            pressure:
              typeof event.pressure === 'number' && event.pressure > 0
                ? event.pressure
                : 0.5,
            tilt: 0,
          },
        ],
      };
      currentStrokeRef.current = newStroke;
      setCurrentStroke(newStroke);
    })
    .onUpdate((event) => {
      if (!currentStrokeRef.current) return;
      const point: Point = {
        x: event.x,
        y: event.y,
        pressure:
          typeof event.pressure === 'number' && event.pressure > 0
            ? event.pressure
            : 0.5,
        tilt: 0,
      };
      const updated: Stroke = {
        ...currentStrokeRef.current,
        points: [...currentStrokeRef.current.points, point],
      };
      currentStrokeRef.current = updated;
      setCurrentStroke(updated);
    })
    .onEnd(() => {
      if (!currentStrokeRef.current) return;
      const finished = currentStrokeRef.current;
      setStrokes((prev) => [...prev, finished]);
      currentStrokeRef.current = null;
      setCurrentStroke(null);
    })
    .onFinalize(() => {
      // Safety net: if gesture is cancelled mid-draw, still commit the stroke
      if (currentStrokeRef.current) {
        const finished = currentStrokeRef.current;
        setStrokes((prev) => [...prev, finished]);
        currentStrokeRef.current = null;
        setCurrentStroke(null);
      }
    });

  // ---- actions ----
  const handleUndo = useCallback(() => {
    setStrokes((prev) => prev.slice(0, -1));
  }, []);

  const handleClear = useCallback(() => {
    Alert.alert('Clear canvas', 'Remove all strokes from this drawing?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => setStrokes([]),
      },
    ]);
  }, []);

  const handleDone = useCallback(() => {
    onSave(strokes);
    onClose();
  }, [strokes, onSave, onClose]);

  // ---- render ----
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(19,19,19,0.97)',
      }}
    >
      {/* Drawing surface */}
      <GestureDetector gesture={panGesture}>
        <View style={{ flex: 1 }}>
          <Canvas style={{ flex: 1 }}>
            {strokes.map((s) => (
              <StrokePath key={s.id} stroke={s} />
            ))}
            {currentStroke && (
              <StrokePath key="current" stroke={currentStroke} />
            )}
          </Canvas>
        </View>
      </GestureDetector>

      {/* Bottom toolbar */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          flexWrap: 'wrap',
          backgroundColor: tokens.bgSidebar,
          borderTopWidth: 1,
          borderTopColor: tokens.border,
          paddingHorizontal: 16,
          paddingVertical: 12,
          paddingBottom: 12 + insets.bottom,
          gap: 12,
        }}
      >
        {/* Pen tool */}
        <ToolCircleButton
          label="✏"
          active={activeTool === 'pen'}
          onPress={() => setActiveTool('pen')}
        />

        {/* Eraser tool */}
        <ToolCircleButton
          label="E"
          active={activeTool === 'eraser'}
          onPress={() => setActiveTool('eraser')}
        />

        {/* Stroke size */}
        {SIZE_OPTIONS.map(({ label, width }) => (
          <Pressable
            key={label}
            onPress={() => setActiveWidth(width)}
            style={{
              width: 36,
              height: 36,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor:
                activeWidth === width ? tokens.accentTint : tokens.bgHover,
              borderWidth: activeWidth === width ? 1 : 0,
              borderColor: tokens.accent,
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: '600',
                color:
                  activeWidth === width ? tokens.accentLight : tokens.textBody,
              }}
            >
              {label}
            </Text>
          </Pressable>
        ))}

        {/* Colour swatches */}
        {PALETTE.map((hex) => (
          <Pressable
            key={hex}
            onPress={() => {
              setActiveColor(hex);
              if (activeTool === 'eraser') setActiveTool('pen');
            }}
            style={{
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: hex,
              borderWidth: activeColor === hex && activeTool === 'pen' ? 2 : 0,
              borderColor: '#FFFFFF',
            }}
          />
        ))}

        {/* Undo */}
        <Pressable
          onPress={handleUndo}
          style={{
            width: 36,
            height: 36,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: tokens.bgHover,
          }}
        >
          <Text style={{ fontSize: 18, color: tokens.textBody }}>↩</Text>
        </Pressable>

        {/* Clear */}
        <Pressable
          onPress={handleClear}
          style={{
            width: 36,
            height: 36,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: tokens.bgHover,
          }}
        >
          <Text style={{ fontSize: 14, color: tokens.textBody }}>✕</Text>
        </Pressable>

        {/* Spacer to push Done to the right */}
        <View style={{ flex: 1 }} />

        {/* Done */}
        <Pressable onPress={handleDone} style={{ paddingHorizontal: 8 }}>
          <Text
            style={{
              fontSize: 15,
              fontWeight: '600',
              color: tokens.accent,
            }}
          >
            Done
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ToolCircleButton — pen / eraser selector (circles are allowed for FABs/tools)
// ---------------------------------------------------------------------------

interface ToolCircleButtonProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

function ToolCircleButton({ label, active, onPress }: ToolCircleButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? tokens.accent : tokens.bgHover,
      }}
    >
      <Text
        style={{
          fontSize: 16,
          color: active ? '#4D2600' : tokens.textBody,
          fontWeight: '600',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
