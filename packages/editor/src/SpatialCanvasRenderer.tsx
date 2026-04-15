/**
 * SpatialCanvasRenderer — v2 canvas renderer.
 *
 * Renders a SpatialCanvasDocument as:
 *   - a single LivePreviewInput (CodeMirror 6 WebView/iframe) showing the
 *     joined markdown of every text block,
 *   - an InkOverlay that mounts only while inkMode is active, layered on
 *     top of the editor via StyleSheet.absoluteFill.
 *
 * The single-CodeMirror-instance decision is explicit (see
 *   docs/specs/plan shimmering-percolating-crayon.md, "Design decisions").
 *
 * Build 75 (2026-04-13): removed the scaled absolutely-positioned stage —
 * on iPad TestFlight WKWebView's internal scroll fought the parent
 * ScrollView's pan responder and the scale transform shifted the hit-test
 * region without updating WKWebView's inner coordinate mapping, so tapping
 * the editor didn't land keyboard focus. Cross-device pixel fidelity is
 * deferred; text input correctness wins.
 *
 * Build 76 (2026-04-13): disabled `enableBlockHeights` on the
 * LivePreviewInput. That prop was the last behavioral difference between
 * this renderer and the working CanvasRenderer — opting into the
 * block-heights ViewPlugin inside the CM6 iframe was blocking keyboard
 * focus and pen capture on v2 notes. The ViewPlugin stays in editorHtml.ts,
 * dormant, so the spatial measurement pipeline can be revived cleanly when
 * free-positioned content lands; we just don't activate it today.
 * Also set `scrollEnabled={!inkMode}` on the outer ScrollView so its
 * native pan recognizer steps aside while the pen is active — previously
 * it won the gesture race and InkOverlay's `onStartShouldSetResponder`
 * never fired.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { tokens } from '@graphite/ui';
import {
  markdownFromChunks,
  type SpatialCanvasDocument,
  type SpatialInkStroke,
} from '@graphite/canvas';
import { LivePreviewInput } from './LivePreviewInput';
import { InkOverlay } from './InkOverlay';
import { InkPassiveOverlay } from './InkPassiveOverlay';
import type { FormatCommand } from './types';

const DEBOUNCE_MS = 500;

export interface SpatialCanvasRendererProps {
  spatialDoc: SpatialCanvasDocument;
  /**
   * Logical canvas width. Kept in the signature for API stability; the
   * renderer no longer scales content to this width (Build 75) — text
   * reflows to the actual viewport. Still forwarded by callers for when
   * the scaled-stage model is revived.
   */
  canvasWidth: number;
  onTextChange?: (markdown: string) => void;
  onInkChange?: (strokes: SpatialInkStroke[]) => void;
  readOnly?: boolean;
  pendingCommand?: FormatCommand | null;
  onCommandApplied?: () => void;
  onActiveFormatsChange?: (formats: FormatCommand[]) => void;
  autoFocusFirst?: boolean;
  focusKey?: string | null;
  /**
   * Defaults to `false`. When `true` the InkOverlay is mounted over the
   * editor and captures pointer input; when `false` the overlay is not
   * in the tree at all — removes any hit-test ambiguity during normal
   * text editing.
   */
  inkMode?: boolean;
  /**
   * Build 115 diagnostic callback forwarded to InkOverlay. Fires on each
   * onResponderGrant so the parent can surface an on-device pc:N counter.
   */
  onInkResponderGrant?: () => void;
  /** Build 115: current pc:N value to display in the LivePreviewInput pill. */
  inkResponderGrantCount?: number;
  /** Build 117: ink stroke color. */
  inkColor?: string;
  /** Build 117: ink stroke width. */
  inkWidth?: number;
}

export function SpatialCanvasRenderer({
  spatialDoc,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  canvasWidth: _canvasWidth,
  onTextChange,
  onInkChange,
  readOnly = false,
  pendingCommand,
  onCommandApplied,
  onActiveFormatsChange,
  autoFocusFirst = false,
  focusKey = null,
  inkMode = false,
  onInkResponderGrant,
  inkResponderGrantCount = 0,
  inkColor,
  inkWidth,
}: SpatialCanvasRendererProps) {
  const [contentSize, setContentSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Joined markdown for the single CodeMirror instance. Uses the same join
  // rule (`\n\n`) as markdownFromChunks so round-tripping is lossless.
  const joinedMarkdown = useMemo(() => {
    const textChunks = spatialDoc.blocks
      .filter((b) => b.type === 'text')
      .map((b) => ({ id: b.id, content: b.content }));
    return markdownFromChunks(textChunks);
  }, [spatialDoc.blocks]);

  const handleTextChange = useCallback(
    (markdown: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onTextChange?.(markdown);
      }, DEBOUNCE_MS);
    },
    [onTextChange],
  );

  const handleInkChange = useCallback(
    (stroke: SpatialInkStroke) => {
      if (!onInkChange) return;
      onInkChange([...spatialDoc.inkStrokes, stroke]);
    },
    [onInkChange, spatialDoc.inkStrokes],
  );

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!inkMode}
        onContentSizeChange={(w: number, h: number) =>
          setContentSize({ width: w, height: h })
        }
      >
        <LivePreviewInput
          key={focusKey ?? 'no-note'}
          value={joinedMarkdown}
          onChange={handleTextChange}
          inputMode={readOnly || inkMode ? 'ink' : 'scroll'}
          pendingCommand={pendingCommand}
          onCommandApplied={onCommandApplied}
          onActiveFormatsChange={onActiveFormatsChange}
          autoFocus={autoFocusFirst}
          diagInkActive={inkMode}
          diagInkResponderGrantCount={inkResponderGrantCount}
        />
        {/* Build 124: always-mounted SVG passive overlay renders committed
            strokes without loading Skia's Metal-backed Canvas. Hidden while
            the Skia InkOverlay is live (inkMode=true) so we don't double-
            render the stroke set, and because the Skia overlay is what
            captures the active in-flight stroke anyway. */}
        {!inkMode && spatialDoc.inkStrokes.length > 0 ? (
          <InkPassiveOverlay
            strokes={spatialDoc.inkStrokes}
            width={contentSize.width}
            height={contentSize.height}
          />
        ) : null}
        {inkMode ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="auto">
            <InkOverlay
              strokes={spatialDoc.inkStrokes}
              width={contentSize.width}
              height={contentSize.height}
              pointerEvents="auto"
              onNewStroke={handleInkChange}
              onResponderGrantDiagnostic={onInkResponderGrant}
              strokeColor={inkColor}
              strokeWidth={inkWidth}
            />
          </View>
        ) : null}
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
    // Build 115: explicit bgBase here too. Previously the inner content
    // container had no bg set, which could render as default white in
    // the padding area on some iOS layouts. Belt-and-suspenders.
    backgroundColor: tokens.bgBase,
  },
});
