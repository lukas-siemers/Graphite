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
  dispatchCommand: (cmd: FormatCommand) => void;
  clearCommand: () => void;
  setActiveFormats: (formats: FormatCommand[]) => void;
  setSelectionState: (state: { hasSelection: boolean; selectionSpansLines: boolean }) => void;
  setSyncState: (state: SyncState) => void;
  setInkMode: (value: boolean) => void;
  toggleInkMode: () => void;
  setSpatialReadyForInk: (ready: boolean) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  pendingCommand: null,
  activeFormats: [],
  hasSelection: false,
  selectionSpansLines: false,
  syncState: 'disabled',
  inkMode: false,
  spatialReadyForInk: false,
  dispatchCommand: (cmd) => set({ pendingCommand: cmd }),
  clearCommand: () => set({ pendingCommand: null }),
  setActiveFormats: (formats) => set({ activeFormats: formats }),
  setSelectionState: ({ hasSelection, selectionSpansLines }) =>
    set({ hasSelection, selectionSpansLines }),
  setSyncState: (syncState) => set({ syncState }),
  setInkMode: (value) => set({ inkMode: value }),
  toggleInkMode: () => set((s) => ({ inkMode: !s.inkMode })),
  setSpatialReadyForInk: (ready) => set({ spatialReadyForInk: ready }),
}));
