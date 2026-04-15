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
  /**
   * Build 118: which drawing tool is active. 'pen' (default) appends new
   * strokes; 'eraser' deletes whole strokes under the pointer path.
   */
  inkTool?: 'pen' | 'eraser';
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
  inkTool = 'pen',
}: SpatialCanvasRendererProps) {
  const [contentSize, setContentSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  // Build 119: track the CM6-reported text content height so the canvas
  // sizes itself to exactly `text + drawable buffer` instead of pinning a
  // 2000px floor. LivePreviewInput.native forwards CM6's 'height' messages
  // via onHeightChange.
  const [textHeight, setTextHeight] = useState<number>(200);
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

  const handleEraseStrokes = useCallback(
    (ids: string[]) => {
      if (!onInkChange) return;
      if (ids.length === 0) return;
      const set = new Set(ids);
      onInkChange(spatialDoc.inkStrokes.filter((s) => !set.has(s.id)));
    },
    [onInkChange, spatialDoc.inkStrokes],
  );

  // Build 119: canvas grows with actual content. No fixed floor — the
  // scrollable area is exactly `max(textHeight, maxInkY) + SCROLL_BUFFER`.
  // SCROLL_BUFFER gives the user a predictable chunk of drawable space
  // below their content so they can always pull the pencil down a bit
  // further; as soon as they draw into the buffer region, maxInkY shifts
  // and the buffer re-extends.
  const maxInkY = useMemo(() => {
    let m = 0;
    for (const s of spatialDoc.inkStrokes) {
      for (const p of s.points) if (p.y > m) m = p.y;
    }
    return m;
  }, [spatialDoc.inkStrokes]);
  const SCROLL_BUFFER = 400;
  const canvasMinHeight = Math.max(textHeight, maxInkY) + SCROLL_BUFFER;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!inkMode}
        // Build 118: hide the iOS default scroll indicator — on the dark
        // editor bg its light track reads as a thin white stripe on the
        // right edge that the user perceived as a "border around the
        // editor".
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        onContentSizeChange={(w: number, h: number) =>
          setContentSize({ width: w, height: h })
        }
      >
        {/* Build 119: explicit bgBase on both the canvas wrapper and the
            absolute-fill overlay. Missing bg on a RN View defaults to
            transparent, which on iPad can composite light artifacts at
            the edge of the scroll view during layout transitions. */}
        <View style={{ minHeight: canvasMinHeight, backgroundColor: tokens.bgBase }}>
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
            onHeightChange={setTextHeight}
          />
          {/* Build 120: conditional mount gated on (inkMode || strokes > 0).
              Build 118 made InkOverlay always-on so strokes would persist
              when the user toggled the pencil off, but on iOS 26 + iPad
              Pro M4 + react-native-skia 2.2.12 the always-on Skia-backed
              CAMetalLayer crashed in [CAMetalLayer nextDrawable] with a
              MTLTextureDescriptor validation abort during UIKit's normal
              drawRect: cycle (see crash 1380A016-…, Build 119 feedback).
              Gating on `strokes.length > 0` preserves the persistence
              goal (once you've drawn anything, the overlay stays mounted
              so the strokes keep rendering), while keeping Skia entirely
              out of the tree for fresh text-only notes. */}
          {(inkMode || spatialDoc.inkStrokes.length > 0) && (
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: 'transparent' }]}
              pointerEvents={inkMode ? 'auto' : 'none'}
            >
              <InkOverlay
                strokes={spatialDoc.inkStrokes}
                width={contentSize.width}
                height={Math.max(contentSize.height, canvasMinHeight)}
                pointerEvents={inkMode ? 'auto' : 'none'}
                onNewStroke={handleInkChange}
                onEraseStrokes={handleEraseStrokes}
                onResponderGrantDiagnostic={onInkResponderGrant}
                strokeColor={inkColor}
                strokeWidth={inkWidth}
                tool={inkTool}
              />
            </View>
          )}
        </View>
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
