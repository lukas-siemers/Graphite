import { create } from 'zustand';
import type { FormatCommand } from '@graphite/editor';
import type { SyncState } from '@graphite/sync';

export type InputMode = 'ink' | 'scroll';

interface EditorState {
  pendingCommand: FormatCommand | null;
  activeFormats: FormatCommand[];
  /** Whether the editor currently has a non-empty selection */
  hasSelection: boolean;
  /** Whether the current selection spans more than one line */
  selectionSpansLines: boolean;
  /** Current input mode — 'ink' for Apple Pencil drawing, 'scroll' for text/touch */
  inputMode: InputMode;
  /** Current sync engine state — drives the status bar indicator */
  syncState: SyncState;
  dispatchCommand: (cmd: FormatCommand) => void;
  clearCommand: () => void;
  setActiveFormats: (formats: FormatCommand[]) => void;
  setSelectionState: (state: { hasSelection: boolean; selectionSpansLines: boolean }) => void;
  setInputMode: (mode: InputMode) => void;
  toggleInputMode: () => void;
  setSyncState: (state: SyncState) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  pendingCommand: null,
  activeFormats: [],
  hasSelection: false,
  selectionSpansLines: false,
  inputMode: 'scroll',
  syncState: 'disabled',
  dispatchCommand: (cmd) => set({ pendingCommand: cmd }),
  clearCommand: () => set({ pendingCommand: null }),
  setActiveFormats: (formats) => set({ activeFormats: formats }),
  setSelectionState: ({ hasSelection, selectionSpansLines }) =>
    set({ hasSelection, selectionSpansLines }),
  setInputMode: (mode) => set({ inputMode: mode }),
  toggleInputMode: () =>
    set((state) => ({ inputMode: state.inputMode === 'ink' ? 'scroll' : 'ink' })),
  setSyncState: (syncState) => set({ syncState }),
}));
