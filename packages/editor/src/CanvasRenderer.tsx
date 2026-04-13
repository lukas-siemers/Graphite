/**
 * CanvasRenderer — CodeMirror 6 live-preview editor.
 *
 * Restores the WebView/iframe-based CodeMirror stack on the rewrite
 * branch so markdown renders live (bold, headers, fenced code, etc.).
 *
 * The plain-TextInput path from Build 70 is gone. It was introduced to
 * escape an iOS UITextView NSRangeException crash (Builds 67–69) caused
 * by React's controlled TextInput pattern fighting with native selection
 * validation — that crash family does not apply here because CodeMirror
 * runs inside WKWebView and never touches UITextView textStorage.
 *
 * Single source of truth:
 *   packages/editor/src/live-preview/editorHtml.ts — the CodeMirror 6
 *   bundle HTML loaded by both the web iframe and the native WebView.
 *
 * Contract kept intact:
 *   - pendingCommand / onCommandApplied / onActiveFormatsChange
 *   - onTextChange debounce semantics (LivePreviewInput emits changes
 *     as the user types; we debounce the save here).
 *   - focusKey remounts the editor on note switch for a clean reset.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { tokens } from '@graphite/ui';
import type { CanvasDocument } from '@graphite/db';
import { LivePreviewInput } from './LivePreviewInput';
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
  const body = canvasDoc.textContent.body;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const handleChange = useCallback(
    (text: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onTextChange?.(text);
      }, DEBOUNCE_MS);
    },
    [onTextChange],
  );

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <LivePreviewInput
          key={focusKey ?? 'no-note'}
          value={body}
          onChange={handleChange}
          inputMode={readOnly ? 'ink' : 'scroll'}
          pendingCommand={pendingCommand}
          onCommandApplied={onCommandApplied}
          onActiveFormatsChange={onActiveFormatsChange}
          autoFocus={autoFocusFirst}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bgBase },
  scroll: { flex: 1, backgroundColor: tokens.bgBase },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 48,
    flexGrow: 1,
  },
});
