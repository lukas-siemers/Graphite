import React from 'react';
import { TextInput, StyleSheet } from 'react-native';
import { tokens } from '@graphite/ui';

interface CanvasTextInputProps {
  value: string;
  onChange: (text: string) => void;
  /** When true the TextInput is not editable — Apple Pencil ink mode active */
  inputMode?: 'ink' | 'scroll';
  placeholder?: string;
}

/**
 * Plain text input segment within the canvas content layer.
 * Transparent background, no border — visually part of the canvas surface.
 * Becomes non-editable when inputMode === 'ink' so pencil taps do not open
 * the software keyboard.
 */
export function CanvasTextInput({
  value,
  onChange,
  inputMode = 'scroll',
  placeholder = 'Start writing...',
}: CanvasTextInputProps) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
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
