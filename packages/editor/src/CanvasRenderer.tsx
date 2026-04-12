/**
 * CanvasRenderer — plain React Native TextInput editor body.
 *
 * Emergency rewrite (build 51): the CodeMirror + iframe + WebView stack
 * was dropped after builds 46-50 shipped with a production-only rendering
 * regression on iOS TestFlight. This file now renders a single multiline
 * TextInput inside a ScrollView — it has no native-heavy dependencies, so
 * the component can be imported at module load time instead of lazily.
 *
 * What stayed:
 *   - canvas_json storage schema (inkLayer.strokes is always empty in v1
 *     but the shape is preserved for Phase 2 sync).
 *   - The pendingCommand / onCommandApplied / onActiveFormatsChange
 *     contract that the FormattingToolbar uses.
 *
 * What's gone:
 *   - Skia ink layer (no @shopify/react-native-skia imports).
 *   - LivePreviewInput and the editorHtml iframe bundle.
 *   - perfect-freehand and inkPath helpers.
 *   - inputMode switching — there is no drawing mode in v1.
 *
 * Apple Pencil drawing comes back as a clean separate slice later.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  TextInput,
  StyleSheet,
  Platform,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import { tokens } from '@graphite/ui';
import type { CanvasDocument } from '@graphite/db';
import { applyFormat } from './applyFormat';
import type { FormatCommand } from './types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CanvasRendererProps {
  canvasDoc: CanvasDocument;
  /** Fixed column width. Defaults to 680. */
  width?: number;
  onTextChange?: (text: string) => void;
  readOnly?: boolean;
  /** Format command dispatched from the toolbar */
  pendingCommand?: FormatCommand | null;
  /** Called when the pending command has been consumed */
  onCommandApplied?: () => void;
  /** Reports which formats are active at the cursor (empty array in v1) */
  onActiveFormatsChange?: (formats: FormatCommand[]) => void;
  /** Auto-focus the editor when first mounted */
  autoFocusFirst?: boolean;
  /** Refocus the editor when the active note changes */
  focusKey?: string | null;
}

const DEBOUNCE_MS = 500;

// ---------------------------------------------------------------------------
// Web-only style reset — remove textarea outline and resize handle
// ---------------------------------------------------------------------------

const webReset =
  Platform.OS === 'web'
    ? ({
        outlineWidth: 0,
        outlineStyle: 'none',
        resize: 'none',
        boxShadow: 'none',
        fontFamily:
          'JetBrainsMono, "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
      } as any)
    : {};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CanvasRenderer({
  canvasDoc,
  width = 680,
  onTextChange,
  readOnly = false,
  pendingCommand,
  onCommandApplied,
  onActiveFormatsChange,
  autoFocusFirst = false,
  focusKey = null,
}: CanvasRendererProps) {
  const externalValue = canvasDoc.textContent.body;

  const [localValue, setLocalValue] = useState(externalValue);
  const [selection, setSelection] = useState<{ start: number; end: number }>({
    start: 0,
    end: 0,
  });
  // Controlled selection payload — fed to TextInput only when we need to
  // restore the cursor after a format command. Setting it to `undefined`
  // during normal typing lets the native input manage its own caret.
  const [controlledSelection, setControlledSelection] = useState<
    { start: number; end: number } | undefined
  >(undefined);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDirtyRef = useRef(false);
  const localValueRef = useRef(localValue);
  const selectionRef = useRef(selection);
  const inputRef = useRef<TextInput | null>(null);

  // Keep refs mirrored to state so effects can read the latest values
  // without re-subscribing on every keystroke.
  useEffect(() => {
    localValueRef.current = localValue;
  }, [localValue]);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  // Sync external value when not actively typing (e.g. switching notes)
  useEffect(() => {
    if (!isDirtyRef.current) {
      setLocalValue(externalValue);
    }
  }, [externalValue]);

  // Refocus when the active note changes
  useEffect(() => {
    if (focusKey && !readOnly) {
      const handle = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(handle);
    }
    return undefined;
  }, [focusKey, readOnly]);

  // Cleanup debounce on unmount (don't lose the last write)
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Active formats are not detected in v1 — the toolbar still gets an
  // empty array so its highlighted-state logic works without branching.
  useEffect(() => {
    onActiveFormatsChange?.([]);
  }, [onActiveFormatsChange]);

  // Apply an incoming format command. We read current text+selection from
  // refs (never from stale state) and dispatch through the pure applyFormat
  // helper. After applying we set controlledSelection once so the TextInput
  // caret matches the new anchor, then clear it on the next tick so native
  // typing regains control.
  useEffect(() => {
    if (!pendingCommand) return;
    onCommandApplied?.();

    if (pendingCommand === 'undo') {
      // Not implemented in v1 — let the native TextInput's built-in undo
      // handle it. Still consume the pending command so it doesn't loop.
      return;
    }

    const currentText = localValueRef.current;
    const currentSel = selectionRef.current;
    const result = applyFormat(currentText, currentSel, pendingCommand);
    if (result.text === currentText && result.selection.start === currentSel.start) {
      return;
    }

    setLocalValue(result.text);
    setControlledSelection(result.selection);
    isDirtyRef.current = true;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      isDirtyRef.current = false;
      onTextChange?.(result.text);
    }, DEBOUNCE_MS);

    // Release controlled selection so subsequent typing is unconstrained
    const releaseHandle = setTimeout(() => setControlledSelection(undefined), 0);
    return () => clearTimeout(releaseHandle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCommand]);

  function handleChange(text: string) {
    setLocalValue(text);
    isDirtyRef.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      isDirtyRef.current = false;
      onTextChange?.(text);
    }, DEBOUNCE_MS);
  }

  function handleSelectionChange(
    e: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) {
    const next = e.nativeEvent.selection;
    setSelection({ start: next.start, end: next.end });
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.bgBase }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: tokens.bgBase }}
        contentContainerStyle={[
          styles.scrollContent,
          { maxWidth: width, width: '100%' },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          ref={inputRef}
          value={localValue}
          onChangeText={handleChange}
          onSelectionChange={handleSelectionChange}
          selection={controlledSelection}
          multiline
          editable={!readOnly}
          autoCorrect={false}
          autoCapitalize="none"
          spellCheck={false}
          autoFocus={autoFocusFirst}
          placeholder="Start writing..."
          placeholderTextColor={tokens.textHint}
          textAlignVertical="top"
          scrollEnabled={false}
          style={[styles.input, webReset]}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 48,
    alignSelf: 'center',
  },
  input: {
    width: '100%',
    minHeight: 400,
    fontSize: 16,
    lineHeight: 24,
    color: tokens.textBody,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    fontFamily: Platform.select({
      ios: 'JetBrainsMono-Regular',
      android: 'JetBrainsMono-Regular',
      default: undefined,
    }),
  },
});
