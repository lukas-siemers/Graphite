import { create } from 'zustand';
import type { FormatCommand } from '@graphite/editor';

interface EditorState {
  previewMode: boolean;
  pendingCommand: FormatCommand | null;
  activeFormats: FormatCommand[];
  /** Whether the editor currently has a non-empty selection */
  hasSelection: boolean;
  /** Whether the current selection spans more than one line */
  selectionSpansLines: boolean;
  setPreviewMode: (v: boolean) => void;
  dispatchCommand: (cmd: FormatCommand) => void;
  clearCommand: () => void;
  setActiveFormats: (formats: FormatCommand[]) => void;
  setSelectionState: (state: { hasSelection: boolean; selectionSpansLines: boolean }) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  previewMode: false,
  pendingCommand: null,
  activeFormats: [],
  hasSelection: false,
  selectionSpansLines: false,
  setPreviewMode: (v) => set({ previewMode: v }),
  dispatchCommand: (cmd) => set({ pendingCommand: cmd }),
  clearCommand: () => set({ pendingCommand: null }),
  setActiveFormats: (formats) => set({ activeFormats: formats }),
  setSelectionState: ({ hasSelection, selectionSpansLines }) =>
    set({ hasSelection, selectionSpansLines }),
}));
