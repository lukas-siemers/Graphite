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
 * The spatial data model is preserved — block heights from the iframe are
 * still captured via the `block-heights` plugin and used to keep the
 * SpatialBlock[] Y positions in sync for future free-positioned content —
 * but layout no longer uses absolute positioning or a scale transform.
 *
 * Build 75 (2026-04-13): the previous implementation wrapped the editor
 * in a scaled absolutely-positioned stage so a fixed logical canvas width
 * would fit the viewport uniformly across devices. On iPad TestFlight that
 * combination broke text input — WKWebView's internal scroll fought the
 * parent ScrollView's pan responder and the scale transform shifted the
 * hit-test region without updating WKWebView's inner coordinate mapping,
 * so tapping the editor didn't land keyboard focus. Cross-device pixel
 * fidelity is deferred; text input correctness wins. The renderer now
 * mirrors CanvasRenderer's plain flex stack.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { tokens } from '@graphite/ui';
import {
  chunksFromMarkdown,
  markdownFromChunks,
  assignYPositions,
  type SpatialBlock,
  type SpatialCanvasDocument,
  type SpatialInkStroke,
} from '@graphite/canvas';
import { LivePreviewInput } from './LivePreviewInput';
import { InkOverlay } from './InkOverlay';
import type { FormatCommand } from './types';
import {
  isBlockHeightsMessage,
  recomputeBlockPositions,
  type MeasuredBlockHeight,
} from './spatial-block-layout';

const DEFAULT_LINE_HEIGHT = 24;
const DEFAULT_BLOCK_GAP = 16;
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
  /** Override for tests / tweaking; defaults to 24px. */
  lineHeightPx?: number;
  /** Override for tests / tweaking; defaults to 16px between blocks. */
  blockGapPx?: number;
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
  lineHeightPx = DEFAULT_LINE_HEIGHT,
  blockGapPx = DEFAULT_BLOCK_GAP,
}: SpatialCanvasRendererProps) {
  // Seed internal block array from the incoming doc. Measured heights from
  // the iframe upgrade this in place. Kept (not yet used for layout) so
  // future free-positioned content can pick up where the scaled stage left
  // off without re-wiring the heights channel.
  const [blocks, setBlocks] = useState<SpatialBlock[]>(() => spatialDoc.blocks);
  const [contentSize, setContentSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep internal blocks in sync when the incoming doc changes identity
  // (note switch, remote sync, etc).
  useEffect(() => {
    setBlocks(spatialDoc.blocks);
  }, [spatialDoc.blocks]);

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
      // Re-chunk the markdown so future `block-heights` messages can be
      // mapped positionally. Y positions will be corrected by the next
      // measurement pass; until then we use the estimator.
      const chunks = chunksFromMarkdown(markdown);
      const next = assignYPositions(chunks, lineHeightPx, blockGapPx);
      setBlocks(next);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onTextChange?.(markdown);
      }, DEBOUNCE_MS);
    },
    [lineHeightPx, blockGapPx, onTextChange],
  );

  const handleBlockHeights = useCallback(
    (msg: { type: 'block-heights'; blocks: MeasuredBlockHeight[] }) => {
      if (!isBlockHeightsMessage(msg)) return;
      setBlocks((prev) => recomputeBlockPositions(prev, msg.blocks, blockGapPx));
    },
    [blockGapPx],
  );

  const handleInkChange = useCallback(
    (stroke: SpatialInkStroke) => {
      if (!onInkChange) return;
      onInkChange([...spatialDoc.inkStrokes, stroke]);
    },
    [onInkChange, spatialDoc.inkStrokes],
  );

  // Silence "blocks is set but never read" — we keep the state + listener
  // live so the heights channel stays warm for the spatial revival.
  void blocks;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
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
          enableBlockHeights
          onBlockHeights={handleBlockHeights}
        />
        {inkMode ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
            <InkOverlay
              strokes={spatialDoc.inkStrokes}
              width={contentSize.width}
              height={contentSize.height}
              pointerEvents="auto"
              onNewStroke={handleInkChange}
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
  },
});
