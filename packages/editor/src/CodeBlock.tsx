import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { tokens } from '@graphite/ui';

interface CodeBlockProps {
  language: string;
  code: string;
}

/**
 * Renders a fenced markdown code block.
 * Background bgDeep, 1px border, 0px radius — developer-tool aesthetic.
 * Copy button in the top-right corner writes the code to the clipboard.
 */
export function CodeBlock({ language, code }: CodeBlockProps) {
  function handleCopy() {
    // React Native's built-in Clipboard shim (deprecated but functional in
    // all RN versions until a dedicated module is added to this project).
    void Clipboard.setStringAsync(code);
  }

  return (
    <View style={styles.container}>
      {/* Header row: language label + copy button */}
      <View style={styles.header}>
        <Text style={styles.language}>
          {language.length > 0 ? language.toUpperCase() : 'PLAINTEXT'}
        </Text>
        <Pressable
          onPress={handleCopy}
          style={({ pressed }: { pressed: boolean }) => [
            styles.copyButton,
            pressed && styles.copyButtonPressed,
          ]}
        >
          <Text style={styles.copyLabel}>COPY</Text>
        </Pressable>
      </View>
      {/* Code content */}
      <Text style={styles.code} selectable>
        {code}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: tokens.bgCode,
    borderWidth: 1,
    borderColor: tokens.border,
    borderRadius: 0,
    marginVertical: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: tokens.border,
  },
  language: {
    fontSize: 10,
    letterSpacing: 0.8,
    color: tokens.textHint,
    fontFamily: 'Courier',
    textTransform: 'uppercase',
  },
  copyButton: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: tokens.bgHover,
  },
  copyButtonPressed: {
    backgroundColor: tokens.bgActive,
  },
  copyLabel: {
    fontSize: 10,
    letterSpacing: 0.8,
    color: tokens.textMuted,
    fontWeight: '600',
  },
  code: {
    fontFamily: 'Courier',
    fontSize: 13,
    lineHeight: 20,
    color: tokens.accentLight,
    padding: 12,
  },
});
