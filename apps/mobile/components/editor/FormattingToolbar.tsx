import { View, Pressable, Text, ScrollView } from 'react-native';
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
function InkControlsIfActive() {
  const inkMode = useEditorStore((s) => s.inkMode);
  if (!inkMode) return null;
  return (
    <>
      <Separator />
      <InkSizeButtons />
      <Separator />
      <InkColorSwatches />
    </>
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

// Build 117: pencil color swatches. Render only when inkMode=true.
const INK_COLORS = [
  '#FFFFFF',
  '#F28500',
  '#F44336',
  '#A8D060',
  '#4FC3F7',
  '#000000',
] as const;

function InkColorSwatches() {
  const inkColor = useEditorStore((s) => s.inkColor);
  const setInkColor = useEditorStore((s) => s.setInkColor);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {INK_COLORS.map((color) => {
        const selected = inkColor.toUpperCase() === color.toUpperCase();
        return (
          <Pressable
            key={color}
            onPress={() => setInkColor(color)}
            accessibilityLabel={`Pencil color ${color}`}
            accessibilityState={{ selected }}
            style={{
              width: 24,
              height: 30,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 16,
                height: 16,
                borderRadius: 8,
                backgroundColor: color,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? tokens.accent : tokens.border,
              }}
            />
          </Pressable>
        );
      })}
    </View>
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
