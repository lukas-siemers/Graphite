/**
 * SpatialCanvasRenderer — v2 canvas renderer.
 *
 * Renders a SpatialCanvasDocument as:
 *   - a single LivePreviewInput (CodeMirror 6 WebView/iframe) showing the
 *     joined markdown of every text block,
 *   - an InkOverlay sibling layered inside the same scroll content at
 *     absolute canvas coordinates.
 *
 * The single-CodeMirror-instance decision is explicit (see
 *   docs/specs/plan shimmering-percolating-crayon.md, "Design decisions").
 * The spatial layout is measurement-only: the iframe reports block heights
 * via the opt-in `block-heights` plugin, and this component recomputes
 * yPosition + height of each SpatialBlock accordingly. Ink strokes carry
 * absolute Y and are unaffected by text reflow.
 *
 * Scale transform: the outer content is rendered at the logical canvas
 * width (`canvasWidth`, typically 816) and then scaled uniformly to fit
 * the parent viewport width. Ink and text share the same transform so their
 * coordinate space stays identical across devices.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet, LayoutChangeEvent } from 'react-native';
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
  computeCanvasHeight,
  type MeasuredBlockHeight,
} from './spatial-block-layout';

const DEFAULT_LINE_HEIGHT = 24;
const DEFAULT_BLOCK_GAP = 16;
const DEFAULT_BOTTOM_PADDING = 240;
const DEBOUNCE_MS = 500;

export interface SpatialCanvasRendererProps {
  spatialDoc: SpatialCanvasDocument;
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
   * Defaults to `false`. When `true` the InkOverlay captures pointer input
   * instead of forwarding to the text layer. Phase 3H wires this to the
   * toolbar toggle; for now the renderer just accepts it as a prop.
   */
  inkMode?: boolean;
  /** Override for tests / tweaking; defaults to 24px. */
  lineHeightPx?: number;
  /** Override for tests / tweaking; defaults to 16px between blocks. */
  blockGapPx?: number;
}

export function SpatialCanvasRenderer({
  spatialDoc,
  canvasWidth,
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
  // Seed internal block array from the incoming doc. When measured heights
  // arrive from the iframe we upgrade this to the measured layout; until
  // then we fall back to the doc's pre-computed estimate (from the chunker).
  const [blocks, setBlocks] = useState<SpatialBlock[]>(() => spatialDoc.blocks);
  const [viewportWidth, setViewportWidth] = useState<number>(canvasWidth);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the internal blocks in sync when the incoming doc changes identity
  // (note switch, remote sync, etc). A shallow reference check on the array
  // is enough — the hook chain always produces a new array when the doc
  // content changes.
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

  const canvasHeight = useMemo(
    () =>
      computeCanvasHeight(
        { ...spatialDoc, blocks },
        DEFAULT_BOTTOM_PADDING,
      ),
    [spatialDoc, blocks],
  );

  // Scale factor applied to the whole canvas surface so that a fixed logical
  // canvasWidth fits the measured viewport. Defaults to 1 until layout
  // reports a width.
  const scale = viewportWidth > 0 ? viewportWidth / canvasWidth : 1;

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0) setViewportWidth(w);
  }, []);

  // The inner "canvas stage" is sized in logical canvas units; scale it so
  // it fills the viewport width. React Native's transform property has no
  // notion of transform-origin, so we pre-shift the stage up/left by half
  // its size * (scale - 1) to achieve a top-left origin (scaling pivots on
  // the layout center by default). On web RN maps transform onto CSS and
  // we can additionally set transformOrigin via style.
  const stageWidth = canvasWidth;
  const stageHeight = canvasHeight;
  const scaledWidth = stageWidth * scale;
  const scaledHeight = stageHeight * scale;
  const translateX = -(stageWidth - scaledWidth) / 2;
  const translateY = -(stageHeight - scaledHeight) / 2;

  return (
    <View style={styles.root} onLayout={handleLayout}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{
          width: scaledWidth,
          height: scaledHeight,
          alignSelf: 'flex-start',
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View
          style={{
            width: stageWidth,
            height: stageHeight,
            transform: [
              { translateX },
              { translateY },
              { scale },
            ],
          }}
        >
          {/*
            The ink layer sits BELOW the text layer in z-order so typed text
            reads cleanly over sketches. pointerEvents gating is handled
            inside InkOverlay by the `pointerEvents` prop.
          */}
          <InkOverlay
            strokes={spatialDoc.inkStrokes}
            width={stageWidth}
            height={stageHeight}
            pointerEvents={inkMode ? 'auto' : 'none'}
            onNewStroke={handleInkChange}
          />
          <View
            pointerEvents={inkMode ? 'none' : 'auto'}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: stageWidth,
              minHeight: stageHeight,
            }}
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
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.bgBase },
  scroll: { flex: 1, backgroundColor: tokens.bgBase },
});
