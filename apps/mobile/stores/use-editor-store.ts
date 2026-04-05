import { create } from 'zustand';
import type { FormatCommand } from '@graphite/editor';

interface EditorState {
  previewMode: boolean;
  pendingCommand: FormatCommand | null;
  activeFormats: FormatCommand[];
  setPreviewMode: (v: boolean) => void;
  dispatchCommand: (cmd: FormatCommand) => void;
  clearCommand: () => void;
  setActiveFormats: (formats: FormatCommand[]) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  previewMode: false,
  pendingCommand: null,
  activeFormats: [],
  setPreviewMode: (v) => set({ previewMode: v }),
  dispatchCommand: (cmd) => set({ pendingCommand: cmd }),
  clearCommand: () => set({ pendingCommand: null }),
  setActiveFormats: (formats) => set({ activeFormats: formats }),
}));
