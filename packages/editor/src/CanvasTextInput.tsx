import React, { useState, useEffect, useRef } from 'react';
import { TextInput, StyleSheet, Platform } from 'react-native';
import { tokens } from '@graphite/ui';
import type { FormatCommand } from './types';
import { applyFormatCommand, detectActiveFormats } from './types';

interface CanvasTextInputProps {
  value: string;
  onChange: (text: string) => void;
  /** When 'ink', TextInput is not editable — Apple Pencil ink mode active */
  inputMode?: 'ink' | 'scroll';
  placeholder?: string;
  /** Notify CanvasRenderer when this input gains focus so it can route commands here */
  onFocus?: () => void;
  /** Format command to apply — only honoured when this input is the last-focused one */
  pendingCommand?: FormatCommand | null;
  /** Called immediately when this input applies (or skips) a pending command */
  onCommandApplied?: () => void;
  /** Reports which formats are active at the current cursor — used to highlight toolbar buttons */
  onActiveFormatsChange?: (formats: FormatCommand[]) => void;
  /** Auto-focus this input when it mounts — used when switching from preview to edit mode */
  autoFocus?: boolean;
}

const DEBOUNCE_MS = 500;

/**
 * Plain text input segment within the canvas content layer.
 *
 * Keeps local state so every keystroke feels instant — the onChange callback
 * (which triggers a SQLite write) is debounced to 500ms after the last change.
 * This prevents per-keystroke re-renders of the whole canvas.
 */
export function CanvasTextInput({
  value,
  onChange,
  inputMode = 'scroll',
  placeholder = 'Start writing...',
  onFocus,
  pendingCommand,
  onCommandApplied,
  onActiveFormatsChange,
  autoFocus = false,
}: CanvasTextInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while the user has unsaved keystrokes — blocks external value sync
  const isDirtyRef = useRef(false);
  // Cursor / selection position tracked via onSelectionChange
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  // Previous value snapshot for single-level undo of format commands
  const prevValueRef = useRef<string>('');

  // Only sync external value (e.g. note switch) when user is not actively typing
  useEffect(() => {
    if (!isDirtyRef.current) {
      setLocalValue(value);
    }
  }, [value]);

  // Apply a pending format command when this input is the active one
  useEffect(() => {
    if (!pendingCommand) return;

    // Notify parent immediately so the command isn't re-applied on re-render
    onCommandApplied?.();

    if (pendingCommand === 'undo') {
      const prev = prevValueRef.current;
      if (prev !== '') {
        setLocalValue(prev);
        isDirtyRef.current = true;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          isDirtyRef.current = false;
          onChange(prev);
        }, DEBOUNCE_MS);
      }
      return;
    }

    // Save snapshot for undo before applying
    prevValueRef.current = localValue;
    const newValue = applyFormatCommand(localValue, selectionRef.current, pendingCommand);
    if (newValue === localValue) return;

    setLocalValue(newValue);
    isDirtyRef.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      isDirtyRef.current = false;
      onChange(newValue);
    }, DEBOUNCE_MS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCommand]);

  function handleChange(text: string) {
    setLocalValue(text);
    isDirtyRef.current = true;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      isDirtyRef.current = false;
      onChange(text);
    }, DEBOUNCE_MS);
  }

  // Flush on unmount so no changes are lost
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <TextInput
      value={localValue}
      onChangeText={handleChange}
      multiline
      editable={inputMode !== 'ink'}
      placeholder={placeholder}
      placeholderTextColor={tokens.textHint}
      style={styles.input}
      textAlignVertical="top"
      scrollEnabled={false}
      autoFocus={autoFocus}
      onFocus={onFocus}
      onSelectionChange={(e) => {
        const sel = e.nativeEvent.selection;
        selectionRef.current = sel;
        if (onActiveFormatsChange) {
          onActiveFormatsChange(detectActiveFormats(localValue, sel));
        }
      }}
    />
  );
}

const webReset = Platform.OS === 'web'
  ? ({
      outlineWidth: 0,
      outlineStyle: 'none',
      // Remove browser-default textarea resize handle and ring
      resize: 'none',
      boxShadow: 'none',
    } as any)
  : {};

const styles = StyleSheet.create({
  input: {
    width: '100%',
    fontSize: 16,
    lineHeight: 24,
    color: tokens.textBody,
    backgroundColor: 'transparent',
    borderWidth: 0,
    padding: 0,
    minHeight: 24,
    ...webReset,
  },
});
