/**
 * InkColorPickerModal — Build 124.
 *
 * macOS-inspired HSV color picker. Replaces the fixed 6-swatch row used
 * since Build 117 with a proper picker:
 *   - Hue bar at the top (horizontal rainbow gradient).
 *   - Saturation × Value square for the selected hue.
 *   - Hex input + preview swatch.
 *   - 9 recent/preset swatches for quick picks.
 *
 * Built with expo-linear-gradient (no Skia — we're avoiding the Metal crash
 * path). Touch handling uses react-native-gesture-handler's Gesture.Pan on
 * each gradient, converting local coords to HSV values.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { tokens } from '@graphite/ui';

// Presets — one row of 9 that cover the common palette including light/dark.
const PRESETS = [
  '#FFFFFF',
  '#C4C4C4',
  '#000000',
  '#F44336',
  '#F28500',
  '#F7C948',
  '#A8D060',
  '#4FC3F7',
  '#9C6ADE',
] as const;

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const v = max;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s, v };
}

function hsvToHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

interface InkColorPickerModalProps {
  visible: boolean;
  onClose: () => void;
  initialColor: string;
  onSelect: (hex: string) => void;
}

const HUE_BAR_WIDTH = 300;
const HUE_BAR_HEIGHT = 20;
const SV_SQUARE_SIZE = 300;

export function InkColorPickerModal({
  visible,
  onClose,
  initialColor,
  onSelect,
}: InkColorPickerModalProps) {
  const parsed = useMemo(
    () => hexToHsv(initialColor) ?? { h: 0, s: 1, v: 1 },
    [initialColor, visible],
  );
  const [h, setH] = useState(parsed.h);
  const [s, setS] = useState(parsed.s);
  const [v, setV] = useState(parsed.v);
  const [hexInput, setHexInput] = useState(initialColor.toUpperCase());
  const hRef = useRef(h);
  const sRef = useRef(s);
  const vRef = useRef(v);
  hRef.current = h;
  sRef.current = s;
  vRef.current = v;

  const currentHex = useMemo(() => hsvToHex(h, s, v), [h, s, v]);

  function syncHex(next: string) {
    setHexInput(next);
    const parsed = hexToHsv(next);
    if (!parsed) return;
    setH(parsed.h);
    setS(parsed.s);
    setV(parsed.v);
  }

  function applyAndClose(hex: string = currentHex) {
    onSelect(hex);
    onClose();
  }

  // Hue bar pan — clamp x to [0, HUE_BAR_WIDTH], map to 0..360.
  const huePan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((e) => {
          const x = Math.max(0, Math.min(HUE_BAR_WIDTH, e.x));
          const nextH = (x / HUE_BAR_WIDTH) * 360;
          setH(nextH);
          setHexInput(hsvToHex(nextH, sRef.current, vRef.current));
        })
        .onUpdate((e) => {
          const x = Math.max(0, Math.min(HUE_BAR_WIDTH, e.x));
          const nextH = (x / HUE_BAR_WIDTH) * 360;
          setH(nextH);
          setHexInput(hsvToHex(nextH, sRef.current, vRef.current));
        })
        .runOnJS(true),
    [],
  );

  // SV square pan — x → saturation, y → value (1 - y/height).
  const svPan = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((e) => {
          const x = Math.max(0, Math.min(SV_SQUARE_SIZE, e.x));
          const y = Math.max(0, Math.min(SV_SQUARE_SIZE, e.y));
          const nextS = x / SV_SQUARE_SIZE;
          const nextV = 1 - y / SV_SQUARE_SIZE;
          setS(nextS);
          setV(nextV);
          setHexInput(hsvToHex(hRef.current, nextS, nextV));
        })
        .onUpdate((e) => {
          const x = Math.max(0, Math.min(SV_SQUARE_SIZE, e.x));
          const y = Math.max(0, Math.min(SV_SQUARE_SIZE, e.y));
          const nextS = x / SV_SQUARE_SIZE;
          const nextV = 1 - y / SV_SQUARE_SIZE;
          setS(nextS);
          setV(nextV);
          setHexInput(hsvToHex(hRef.current, nextS, nextV));
        })
        .runOnJS(true),
    [],
  );

  const hueBarColors = [
    '#FF0000',
    '#FFFF00',
    '#00FF00',
    '#00FFFF',
    '#0000FF',
    '#FF00FF',
    '#FF0000',
  ];
  const hueMarkerX = (h / 360) * HUE_BAR_WIDTH - 2;
  const svMarkerX = s * SV_SQUARE_SIZE - 8;
  const svMarkerY = (1 - v) * SV_SQUARE_SIZE - 8;
  const hueColor = hsvToHex(h, 1, 1);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.55)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            width: SV_SQUARE_SIZE + 40,
            backgroundColor: tokens.bgSidebar,
            padding: 20,
          }}
        >
          <Text
            style={{
              fontSize: 11,
              color: tokens.textMuted,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              marginBottom: 12,
            }}
          >
            Pencil Color
          </Text>

          {/* Saturation × Value square */}
          <GestureDetector gesture={svPan}>
            <View
              style={{
                width: SV_SQUARE_SIZE,
                height: SV_SQUARE_SIZE,
                backgroundColor: hueColor,
                overflow: 'hidden',
              }}
            >
              {/* White → transparent horizontal (saturation) */}
              <LinearGradient
                colors={['#FFFFFF', 'rgba(255,255,255,0)']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                }}
              />
              {/* Transparent → black vertical (value) */}
              <LinearGradient
                colors={['rgba(0,0,0,0)', '#000000']}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                }}
              />
              {/* Marker — 16px ring with a white outline and dark shadow */}
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: svMarkerX,
                  top: svMarkerY,
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  borderWidth: 2,
                  borderColor: '#FFFFFF',
                  backgroundColor: 'transparent',
                }}
              />
            </View>
          </GestureDetector>

          {/* Hue bar */}
          <View style={{ marginTop: 16 }}>
            <GestureDetector gesture={huePan}>
              <View
                style={{
                  width: HUE_BAR_WIDTH,
                  height: HUE_BAR_HEIGHT,
                }}
              >
                <LinearGradient
                  colors={hueBarColors}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={{
                    width: HUE_BAR_WIDTH,
                    height: HUE_BAR_HEIGHT,
                  }}
                />
                {/* Hue marker */}
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    top: -2,
                    left: hueMarkerX,
                    width: 4,
                    height: HUE_BAR_HEIGHT + 4,
                    backgroundColor: '#FFFFFF',
                  }}
                />
              </View>
            </GestureDetector>
          </View>

          {/* Hex input + preview */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginTop: 16,
              gap: 12,
            }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                backgroundColor: currentHex,
                borderWidth: 1,
                borderColor: tokens.border,
              }}
            />
            <TextInput
              value={hexInput}
              onChangeText={syncHex}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={7}
              placeholder="#FFFFFF"
              placeholderTextColor={tokens.textHint}
              style={{
                flex: 1,
                height: 36,
                paddingHorizontal: 12,
                backgroundColor: tokens.bgBase,
                color: tokens.textPrimary,
                borderWidth: 1,
                borderColor: tokens.border,
                fontSize: 13,
                letterSpacing: 1,
              }}
            />
          </View>

          {/* Preset row */}
          <View
            style={{
              flexDirection: 'row',
              marginTop: 16,
              gap: 4,
            }}
          >
            {PRESETS.map((preset) => (
              <Pressable
                key={preset}
                onPress={() => syncHex(preset)}
                accessibilityLabel={`Preset ${preset}`}
                style={{
                  flex: 1,
                  height: 24,
                  backgroundColor: preset,
                  borderWidth: 1,
                  borderColor: tokens.border,
                }}
              />
            ))}
          </View>

          {/* Footer actions */}
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'flex-end',
              marginTop: 18,
              gap: 8,
            }}
          >
            <Pressable
              onPress={onClose}
              style={({ pressed }) => ({
                paddingVertical: 8,
                paddingHorizontal: 16,
                backgroundColor: pressed ? tokens.bgHover : 'transparent',
                borderWidth: 1,
                borderColor: tokens.border,
              })}
            >
              <Text
                style={{ fontSize: 13, color: tokens.textBody, fontWeight: '500' }}
              >
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={() => applyAndClose()}
              style={({ pressed }) => ({
                paddingVertical: 8,
                paddingHorizontal: 16,
                backgroundColor: pressed ? tokens.accentPressed : tokens.accent,
              })}
            >
              <Text
                style={{
                  fontSize: 13,
                  color: '#FFFFFF',
                  fontWeight: '600',
                }}
              >
                Select
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
