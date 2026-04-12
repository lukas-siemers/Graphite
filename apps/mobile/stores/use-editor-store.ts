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
  /**
   * When true, the editor body is rendered as a full-screen PencilKit canvas
   * instead of the TextInput. The two modes are mutually exclusive at the
   * render-tree level — see DrawingCanvas.tsx and CLAUDE.md "iOS production
   * startup trap" for why we never mount them side-by-side.
   */
  drawMode: boolean;
  dispatchCommand: (cmd: FormatCommand) => void;
  clearCommand: () => void;
  setActiveFormats: (formats: FormatCommand[]) => void;
  setSelectionState: (state: { hasSelection: boolean; selectionSpansLines: boolean }) => void;
  setSyncState: (state: SyncState) => void;
  setDrawMode: (value: boolean) => void;
  toggleDrawMode: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  pendingCommand: null,
  activeFormats: [],
  hasSelection: false,
  selectionSpansLines: false,
  syncState: 'disabled',
  drawMode: false,
  dispatchCommand: (cmd) => set({ pendingCommand: cmd }),
  clearCommand: () => set({ pendingCommand: null }),
  setActiveFormats: (formats) => set({ activeFormats: formats }),
  setSelectionState: ({ hasSelection, selectionSpansLines }) =>
    set({ hasSelection, selectionSpansLines }),
  setSyncState: (syncState) => set({ syncState }),
  setDrawMode: (value) => set({ drawMode: value }),
  toggleDrawMode: () => set((state) => ({ drawMode: !state.drawMode })),
}));
