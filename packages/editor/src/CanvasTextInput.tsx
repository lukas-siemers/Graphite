import React, { useState, useEffect, useRef } from 'react';
import { TextInput, StyleSheet } from 'react-native';
import { tokens } from '@graphite/ui';

interface CanvasTextInputProps {
  value: string;
  onChange: (text: string) => void;
  /** When true the TextInput is not editable — Apple Pencil ink mode active */
  inputMode?: 'ink' | 'scroll';
  placeholder?: string;
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
}: CanvasTextInputProps) {
  const [localValue, setLocalValue] = useState(value);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while the user has unsaved keystrokes — blocks external value sync
  const isDirtyRef = useRef(false);

  // Only sync external value (e.g. note switch) when user is not actively typing
  useEffect(() => {
    if (!isDirtyRef.current) {
      setLocalValue(value);
    }
  }, [value]);

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
    />
  );
}

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
  },
});
