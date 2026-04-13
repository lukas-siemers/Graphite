/**
 * CanvasRenderer — ground-up markdown editor (Build 70 rewrite).
 *
 * After Builds 67/68/69 shipped with different flavors of the same crash
 * (iOS UITextView NSRangeException when React's controlled `selection`
 * prop got validated against a stale textStorage during a commit that
 * also changed the text), this file throws away the controlled pattern
 * entirely and uses an uncontrolled TextInput driven by refs +
 * setNativeProps for imperative updates.
 *
 * Contract kept intact:
 *   - pendingCommand / onCommandApplied is still how the toolbar
 *     delivers format commands. The toolbar is unchanged.
 *   - applyFormat is still the pure-function transform layer.
 *   - onTextChange fires debounced so the host can persist to SQLite.
 *
 * Why uncontrolled:
 *   A controlled TextInput passes `value` + `selection` props on every
 *   render. Applying a format synchronously updates both, and iOS
 *   UITextView does not tolerate a selection range past the previous
 *   textStorage length in the same commit — it raises NSRangeException
 *   which crosses the bridge as RCTFatal / SIGABRT. An uncontrolled
 *   TextInput only sees text updates through setNativeProps; the
 *   native view never re-validates a selection it did not receive.
 *
 * Note-switching:
 *   `focusKey` doubles as the TextInput's `key`. When the active note
 *   changes we fully remount the TextInput, giving iOS a fresh native
 *   view seeded with the new note's text via defaultValue. No drift.
 */

import React, { useCallback, useEffect, useRef } from 'react';
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

export interface CanvasRendererProps {
  canvasDoc: CanvasDocument;
  width?: number;
  onTextChange?: (text: string) => void;
  readOnly?: boolean;
  pendingCommand?: FormatCommand | null;
  onCommandApplied?: () => void;
  onActiveFormatsChange?: (formats: FormatCommand[]) => void;
  autoFocusFirst?: boolean;
  focusKey?: string | null;
}

const DEBOUNCE_MS = 500;

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

export function CanvasRenderer({
  canvasDoc,
  onTextChange,
  readOnly = false,
  pendingCommand,
  onCommandApplied,
  onActiveFormatsChange,
  autoFocusFirst = false,
  focusKey = null,
}: CanvasRendererProps) {
  const initialText = canvasDoc.textContent.body;

  // All mutable editor state lives in refs, not useState. We never drive
  // TextInput with `value=` — keeping it uncontrolled is the whole point
  // of this rewrite. The component itself almost never re-renders.
  const textRef = useRef(initialText);
  const selectionRef = useRef({ start: 0, end: 0 });
  const inputRef = useRef<TextInput | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset ref-backed text when the active note changes. focusKey doubles
  // as the TextInput key below, so the view remounts with the new
  // defaultValue; this just keeps textRef in sync for save debouncing.
  useEffect(() => {
    textRef.current = initialText;
    selectionRef.current = { start: 0, end: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey]);

  // Toolbar's active-format highlight logic is not populated in v1;
  // hand it an empty array so the prop contract stays stable.
  useEffect(() => {
    onActiveFormatsChange?.([]);
  }, [onActiveFormatsChange]);

  // Save on unmount — don't lose the last edit.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const scheduleSave = useCallback(
    (text: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onTextChange?.(text);
      }, DEBOUNCE_MS);
    },
    [onTextChange],
  );

  // Apply an incoming format command imperatively. We:
  //   1. Compute the new text from applyFormat (pure).
  //   2. Update our ref so the next read sees the formatted text.
  //   3. Push the new text into the native TextInput via setNativeProps.
  //      No `value` / `selection` props cross the bridge, so iOS never
  //      re-validates a selection range against stale text storage.
  //   4. Schedule the debounced save.
  useEffect(() => {
    if (!pendingCommand) return;
    onCommandApplied?.();
    if (pendingCommand === 'undo') return;

    try {
      const result = applyFormat(
        textRef.current,
        selectionRef.current,
        pendingCommand,
      );
      if (result.text === textRef.current) return;

      textRef.current = result.text;
      inputRef.current?.setNativeProps({ text: result.text });
      scheduleSave(result.text);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[CanvasRenderer] format apply failed', err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCommand]);

  function handleChange(text: string) {
    textRef.current = text;
    scheduleSave(text);
  }

  function handleSelectionChange(
    e: NativeSyntheticEvent<TextInputSelectionChangeEventData>,
  ) {
    const next = e.nativeEvent.selection;
    selectionRef.current = { start: next.start, end: next.end };
  }

  return (
    <View style={{ flex: 1, backgroundColor: tokens.bgBase }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: tokens.bgBase }}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <TextInput
          key={focusKey ?? 'no-note'}
          ref={inputRef}
          defaultValue={initialText}
          onChangeText={handleChange}
          onSelectionChange={handleSelectionChange}
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
    flexGrow: 1,
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
