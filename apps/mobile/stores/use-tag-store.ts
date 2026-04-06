import { create } from 'zustand';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getAllTags } from '@graphite/db';

interface TagEntry {
  id: string;
  name: string;
  count: number;
}

interface TagState {
  tags: TagEntry[];
  activeTag: string | null;
  loadTags: (db: SQLiteDatabase) => Promise<void>;
  setActiveTag: (name: string | null) => void;
}

export const useTagStore = create<TagState>((set) => ({
  tags: [],
  activeTag: null,

  loadTags: async (db: SQLiteDatabase) => {
    const tags = await getAllTags(db);
    set({ tags });
  },

  setActiveTag: (name: string | null) => {
    set((state) => ({
      activeTag: state.activeTag === name ? null : name,
    }));
  },
}));
