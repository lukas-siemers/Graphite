import { create } from 'zustand';
import type { FormatCommand } from '@graphite/editor';
import type { SyncState } from '@graphite/sync';

interface EditorState {
  pendingCommand: FormatCommand | null;
  activeFormats: FormatCommand[];
  /** Whether the editor currently has a non-empty selection */
  hasSelection: boolean;
  /** Whether the current selection spans more than one line */
  selectionSpansLines: boolean;
  /** Current sync engine state — drives the status bar indicator */
  syncState: SyncState;
  /** v2 spatial-canvas ink-capture mode. Toolbar toggles; Editor threads it
   *  into SpatialCanvasRenderer. Always false for v1 notes. */
  inkMode: boolean;
  /**
   * Build 114: true once SpatialCanvasRenderer has fully mounted for the
   * active note (module lazy-loaded + spatialDoc resolved + spatialReady).
   * The formatting toolbar's pencil/ink button gates its visibility on
   * this flag so the user can never toggle ink mode against a non-ink
   * renderer. Editor.tsx sets this in a useEffect whenever the render
   * conditions change.
   */
  spatialReadyForInk: boolean;
  /**
   * Build 115 diagnostic: increments every time InkOverlay's
   * onResponderGrant successfully claims a touch (finger or pencil).
   * LivePreviewInput reads this and shows pc:N in the phase pill.
   * pc remaining 0 after the user tries to draw = touches are not
   * reaching InkOverlay → gesture-race problem (needs RNGH migration).
   * pc > 0 with no visible stroke = downstream Skia paint bug.
   */
  inkResponderGrantCount: number;
  /**
   * Build 117: currently-selected pencil color. InkOverlay uses this
   * as the stroke color when creating a new stroke. Toolbar color
   * swatch row (visible only when inkMode=true) writes to this.
   */
  inkColor: string;
  /**
   * Build 117: currently-selected pencil width. InkOverlay uses this
   * as the stroke width when creating a new stroke. Toolbar size
   * button row (visible only when inkMode=true) writes to this.
   */
  inkWidth: number;
  /**
   * Build 118: currently-selected ink tool. 'pen' draws; 'eraser' deletes
   * entire strokes under the pointer. Only meaningful while inkMode=true.
   */
  inkTool: 'pen' | 'eraser';
  dispatchCommand: (cmd: FormatCommand) => void;
  clearCommand: () => void;
  setActiveFormats: (formats: FormatCommand[]) => void;
  setSelectionState: (state: { hasSelection: boolean; selectionSpansLines: boolean }) => void;
  setSyncState: (state: SyncState) => void;
  setInkMode: (value: boolean) => void;
  toggleInkMode: () => void;
  setSpatialReadyForInk: (ready: boolean) => void;
  incrementInkResponderGrant: () => void;
  setInkColor: (color: string) => void;
  setInkWidth: (width: number) => void;
  setInkTool: (tool: 'pen' | 'eraser') => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  pendingCommand: null,
  activeFormats: [],
  hasSelection: false,
  selectionSpansLines: false,
  syncState: 'disabled',
  inkMode: false,
  spatialReadyForInk: false,
  inkResponderGrantCount: 0,
  inkColor: '#FFFFFF',
  inkWidth: 2.5,
  inkTool: 'pen',
  dispatchCommand: (cmd) => set({ pendingCommand: cmd }),
  clearCommand: () => set({ pendingCommand: null }),
  setActiveFormats: (formats) => set({ activeFormats: formats }),
  setSelectionState: ({ hasSelection, selectionSpansLines }) =>
    set({ hasSelection, selectionSpansLines }),
  setSyncState: (syncState) => set({ syncState }),
  setInkMode: (value) => set({ inkMode: value }),
  toggleInkMode: () => set((s) => ({ inkMode: !s.inkMode })),
  setSpatialReadyForInk: (ready) => set({ spatialReadyForInk: ready }),
  incrementInkResponderGrant: () =>
    set((s) => ({ inkResponderGrantCount: s.inkResponderGrantCount + 1 })),
  setInkColor: (color) => set({ inkColor: color }),
  setInkWidth: (width) => set({ inkWidth: width }),
  setInkTool: (tool) => set({ inkTool: tool }),
}));
