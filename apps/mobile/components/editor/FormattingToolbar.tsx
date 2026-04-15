import { useMemo, useState } from 'react';
import { View, Pressable, Text, ScrollView, Modal } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { tokens } from '@graphite/ui';
import type { FormatCommand } from '@graphite/editor';
import { useEditorStore } from '../../stores/use-editor-store';
import { useNoteStore } from '../../stores/use-note-store';

function Separator() {
  return (
    <View
      style={{
        width: 1,
        height: 20,
        backgroundColor: tokens.border,
        marginHorizontal: 4,
      }}
    />
  );
}

interface ToolbarButtonProps {
  command: FormatCommand;
  icon?: string;
  label?: string;
  active?: boolean;
  /** Optional override — when provided, pressing dispatches this instead of `command` */
  onPress?: () => void;
  onLongPress?: () => void;
}

function ToolbarButton({ command, icon, label, active = false, onPress, onLongPress }: ToolbarButtonProps) {
  const dispatchCommand = useEditorStore((s) => s.dispatchCommand);

  return (
    <Pressable
      onPress={() => (onPress ? onPress() : dispatchCommand(command))}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => ({
        width: 30,
        height: 30,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active
          ? tokens.bgHover
          : pressed
          ? tokens.bgBright
          : 'transparent',
        marginHorizontal: 1,
        borderBottomWidth: active ? 2 : 0,
        borderBottomColor: tokens.accent,
      })}
    >
      {icon ? (
        <MaterialCommunityIcons
          name={icon as any}
          size={16}
          color={active ? tokens.accentLight : tokens.textMuted}
        />
      ) : (
        <Text
          style={{
            fontSize: 12,
            fontWeight: '600',
            color: active ? tokens.accentLight : tokens.textMuted,
            letterSpacing: -0.3,
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

// Build 117: conditionally render size + color pickers only when inkMode
// is active. Keeps the toolbar minimal when user is just writing text.
// Build 118: adds the eraser tool toggle + replaces the swatch row with a
// popup color-picker button.
function InkControlsIfActive() {
  const inkMode = useEditorStore((s) => s.inkMode);
  if (!inkMode) return null;
  return (
    <>
      <Separator />
      <InkToolButtons />
      <Separator />
      <InkSizeButtons />
      <Separator />
      <InkColorPickerButton />
    </>
  );
}

// Build 118: pen / eraser tool toggle. Two mutually-exclusive buttons that
// switch the active drawing tool. Pen is default; eraser deletes whole
// strokes under the pointer (stroke-level erase).
function InkToolButtons() {
  const inkTool = useEditorStore((s) => s.inkTool);
  const setInkTool = useEditorStore((s) => s.setInkTool);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Pressable
        onPress={() => setInkTool('pen')}
        accessibilityLabel="Pen"
        accessibilityState={{ selected: inkTool === 'pen' }}
        style={({ pressed }) => ({
          width: 30,
          height: 30,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor:
            inkTool === 'pen'
              ? tokens.accentTint
              : pressed
              ? tokens.bgBright
              : 'transparent',
          marginHorizontal: 1,
        })}
      >
        <MaterialCommunityIcons
          name="fountain-pen-tip"
          size={16}
          color={inkTool === 'pen' ? tokens.accent : tokens.textMuted}
        />
      </Pressable>
      <Pressable
        onPress={() => setInkTool('eraser')}
        accessibilityLabel="Eraser"
        accessibilityState={{ selected: inkTool === 'eraser' }}
        style={({ pressed }) => ({
          width: 30,
          height: 30,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor:
            inkTool === 'eraser'
              ? tokens.accentTint
              : pressed
              ? tokens.bgBright
              : 'transparent',
          marginHorizontal: 1,
        })}
      >
        <MaterialCommunityIcons
          name="eraser"
          size={16}
          color={inkTool === 'eraser' ? tokens.accent : tokens.textMuted}
        />
      </Pressable>
    </View>
  );
}

function InkToggleButton() {
  const inkMode = useEditorStore((s) => s.inkMode);
  const toggleInkMode = useEditorStore((s) => s.toggleInkMode);

  return (
    <Pressable
      onPress={toggleInkMode}
      accessibilityLabel="Toggle drawing mode"
      accessibilityState={{ selected: inkMode }}
      style={({ pressed }) => ({
        width: 30,
        height: 30,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: inkMode
          ? tokens.accentTint
          : pressed
          ? tokens.bgBright
          : 'transparent',
        marginHorizontal: 1,
      })}
    >
      {({ pressed }) => (
        <MaterialCommunityIcons
          name="pencil"
          size={16}
          color={
            inkMode
              ? pressed
                ? tokens.accentPressed
                : tokens.accent
              : tokens.textMuted
          }
        />
      )}
    </Pressable>
  );
}

// Build 117: pencil size picker. Renders only when inkMode=true. Three
// options: thin / medium / thick, each shown as a filled dot of the
// corresponding diameter. Selection persists via useEditorStore.
const INK_SIZES = [
  { width: 1.5, dotSize: 4 },
  { width: 2.5, dotSize: 7 },
  { width: 5, dotSize: 11 },
] as const;

function InkSizeButtons() {
  const inkWidth = useEditorStore((s) => s.inkWidth);
  const setInkWidth = useEditorStore((s) => s.setInkWidth);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {INK_SIZES.map(({ width, dotSize }) => {
        const selected = Math.abs(inkWidth - width) < 0.01;
        return (
          <Pressable
            key={width}
            onPress={() => setInkWidth(width)}
            accessibilityLabel={`Pencil width ${width}`}
            accessibilityState={{ selected }}
            style={{
              width: 28,
              height: 30,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? tokens.accentTint : 'transparent',
            }}
          >
            <View
              style={{
                width: dotSize,
                height: dotSize,
                borderRadius: dotSize / 2,
                backgroundColor: selected ? tokens.accent : tokens.textMuted,
              }}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

// Build 118: single color-indicator button that opens a popup picker
// modal. Replaces the fixed swatch strip — users now reach a full HSL
// grid plus a grayscale strip, keeping the toolbar compact when idle.
function InkColorPickerButton() {
  const inkColor = useEditorStore((s) => s.inkColor);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityLabel="Pick pencil color"
        style={({ pressed }) => ({
          width: 30,
          height: 30,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? tokens.bgBright : 'transparent',
          marginHorizontal: 1,
        })}
      >
        <View
          style={{
            width: 18,
            height: 18,
            backgroundColor: inkColor,
            borderWidth: 1,
            borderColor: tokens.border,
          }}
        />
      </Pressable>
      <InkColorPickerModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

// Build 118: HSL-sampled color grid. 12 hues × 5 lightness levels gives
// 60 colors, plus a 9-step grayscale row. Flat squares, no gradients —
// matches the Digital Monolith design system while still giving the user
// a real spectrum of color choices.
const HUE_STEPS = 12;
const LIGHTNESS_STEPS = [0.25, 0.42, 0.55, 0.7, 0.85] as const;
const GRAYSCALE = [
  '#000000',
  '#1C1C1C',
  '#333333',
  '#555555',
  '#7A7A7A',
  '#9E9E9E',
  '#C4C4C4',
  '#E2E2E2',
  '#FFFFFF',
] as const;

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

function InkColorPickerModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const inkColor = useEditorStore((s) => s.inkColor);
  const setInkColor = useEditorStore((s) => s.setInkColor);

  const hueGrid = useMemo(() => {
    const rows: string[][] = [];
    for (const l of LIGHTNESS_STEPS) {
      const row: string[] = [];
      for (let i = 0; i < HUE_STEPS; i++) {
        const h = (i * 360) / HUE_STEPS;
        row.push(hslToHex(h, 0.85, l));
      }
      rows.push(row);
    }
    return rows;
  }, []);

  const selectedUpper = inkColor.toUpperCase();

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Pressable
          // Swallow taps inside the panel so they don't close the modal.
          onPress={() => {}}
          style={{
            backgroundColor: tokens.bgSidebar,
            padding: 16,
          }}
        >
          <Text
            style={{
              color: tokens.textMuted,
              fontSize: 11,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              marginBottom: 10,
            }}
          >
            Pencil Color
          </Text>

          {hueGrid.map((row, rowIdx) => (
            <View
              key={rowIdx}
              style={{ flexDirection: 'row', marginBottom: 2 }}
            >
              {row.map((color) => {
                const isSelected = color === selectedUpper;
                return (
                  <Pressable
                    key={color}
                    onPress={() => {
                      setInkColor(color);
                      onClose();
                    }}
                    accessibilityLabel={`Color ${color}`}
                    style={{
                      width: 26,
                      height: 26,
                      marginRight: 2,
                      backgroundColor: color,
                      borderWidth: isSelected ? 2 : 0,
                      borderColor: tokens.accent,
                    }}
                  />
                );
              })}
            </View>
          ))}

          <View style={{ height: 8 }} />
          <View style={{ flexDirection: 'row' }}>
            {GRAYSCALE.map((color) => {
              const isSelected = color === selectedUpper;
              return (
                <Pressable
                  key={color}
                  onPress={() => {
                    setInkColor(color);
                    onClose();
                  }}
                  accessibilityLabel={`Color ${color}`}
                  style={{
                    width: 26,
                    height: 26,
                    marginRight: 2,
                    backgroundColor: color,
                    borderWidth: isSelected ? 2 : 1,
                    borderColor: isSelected ? tokens.accent : tokens.border,
                  }}
                />
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function FormattingToolbar() {
  const activeFormats = useEditorStore((s) => s.activeFormats);
  const hasSelection = useEditorStore((s) => s.hasSelection);
  const selectionSpansLines = useEditorStore((s) => s.selectionSpansLines);
  const dispatchCommand = useEditorStore((s) => s.dispatchCommand);
  const activeNoteId = useNoteStore((s) => s.activeNoteId);
  const notes = useNoteStore((s) => s.notes);
  const activeNote = notes.find((n) => n.id === activeNoteId) ?? null;
  const isV2 = activeNote?.canvasVersion === 2;
  // Build 114: pencil button visibility is gated on SpatialCanvasRenderer
  // being actually mounted + ready for the active note, not just on
  // canvasVersion===2. Editor.tsx computes this and threads it into the
  // store; toolbar hides the button if the spatial pipeline isn't live.
  const spatialReadyForInk = useEditorStore((s) => s.spatialReadyForInk);
  function isActive(cmd: FormatCommand) {
    return activeFormats.includes(cmd);
  }

  // Unified Code button dispatch:
  //   - empty selection or multi-line selection  → code-block
  //   - single-line non-empty selection          → code-inline
  //   - long-press                                → code-block (forced)
  function handleCodePress() {
    if (hasSelection && !selectionSpansLines) {
      dispatchCommand('code-inline');
    } else {
      dispatchCommand('code-block');
    }
  }

  function handleCodeLongPress() {
    dispatchCommand('code-block');
  }

  const codeActive = isActive('code-inline') || isActive('code-block');

  return (
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
      {/* Scrollable button groups */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flex: 1 }}
        contentContainerStyle={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 8,
        }}
        keyboardShouldPersistTaps="always"
      >
        {/* Group 1 — History */}
        <ToolbarButton command="undo" icon="undo-variant" />

        <Separator />

        {/* Group 2 — Inline text style */}
        <ToolbarButton command="bold" icon="format-bold" active={isActive('bold')} />
        <ToolbarButton command="italic" icon="format-italic" />
        <ToolbarButton command="strikethrough" icon="format-strikethrough-variant" active={isActive('strikethrough')} />
        {/* Unified Code button — inline vs block decided by current selection,
            long-press forces block. Replaces the previous two buttons. */}
        <ToolbarButton
          command="code-inline"
          icon="code-tags"
          active={codeActive}
          onPress={handleCodePress}
          onLongPress={handleCodeLongPress}
        />

        <Separator />

        {/* Group 3 — Headings */}
        <ToolbarButton command="h1" icon="format-header-1" active={isActive('h1')} />
        <ToolbarButton command="h2" icon="format-header-2" active={isActive('h2')} />
        <ToolbarButton command="h3" icon="format-header-3" active={isActive('h3')} />

        <Separator />

        {/* Group 4 — Block elements */}
        <ToolbarButton command="bullet-list" icon="format-list-bulleted" active={isActive('bullet-list')} />
        <ToolbarButton command="numbered-list" icon="format-list-numbered" active={isActive('numbered-list')} />
        <ToolbarButton command="blockquote" icon="format-quote-open" active={isActive('blockquote')} />

        <Separator />

        {/* Group 5 — Insert */}
        <ToolbarButton command="link" icon="link-variant" />

        {isV2 && spatialReadyForInk && (
          <>
            <Separator />
            <InkToggleButton />
            <InkControlsIfActive />
          </>
        )}
      </ScrollView>
    </View>
  );
}
