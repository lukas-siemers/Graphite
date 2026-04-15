import { create } from 'zustand';
import { getDatabase, getSetting, setSetting } from '@graphite/db';

export type AppFontKey =
  | 'system'
  | 'newsreader'
  | 'mplus-rounded'
  | 'ibm-plex-condensed'
  | 'raleway';

export interface AppFontOption {
  key: AppFontKey;
  label: string;
  description: string;
  regular: string | undefined;
  bold: string | undefined;
}

// Build 121: 5 selectable app-wide fonts. `regular`/`bold` map to the
// family names registered via expo-font (the file name without extension).
// `system` uses iOS's San Francisco / Android's Roboto — no custom file.
export const APP_FONT_OPTIONS: readonly AppFontOption[] = [
  {
    key: 'system',
    label: 'System',
    description: 'Native system font',
    regular: undefined,
    bold: undefined,
  },
  {
    key: 'newsreader',
    label: 'Newsreader',
    description: 'Serif, editorial',
    regular: 'Newsreader-Regular',
    bold: 'Newsreader-Bold',
  },
  {
    key: 'mplus-rounded',
    label: 'M PLUS Rounded',
    description: 'Soft rounded sans',
    regular: 'MPLUSRounded1c-Regular',
    bold: 'MPLUSRounded1c-Bold',
  },
  {
    key: 'ibm-plex-condensed',
    label: 'IBM Plex Sans Cond.',
    description: 'Technical condensed',
    regular: 'IBMPlexSansCondensed-Regular',
    bold: 'IBMPlexSansCondensed-Bold',
  },
  {
    key: 'raleway',
    label: 'Raleway',
    description: 'Elegant sans',
    regular: 'Raleway-Regular',
    bold: 'Raleway-Bold',
  },
] as const;

const DEFAULT_FONT: AppFontKey = 'system';
const SETTING_KEY = 'app_font';

function optionFor(key: AppFontKey): AppFontOption {
  return APP_FONT_OPTIONS.find((o) => o.key === key) ?? APP_FONT_OPTIONS[0];
}

interface FontState {
  font: AppFontKey;
  regularFamily: string | undefined;
  boldFamily: string | undefined;
  setFont: (key: AppFontKey) => Promise<void>;
  hydrate: () => Promise<void>;
}

export const useFontStore = create<FontState>((set) => ({
  font: DEFAULT_FONT,
  regularFamily: optionFor(DEFAULT_FONT).regular,
  boldFamily: optionFor(DEFAULT_FONT).bold,
  setFont: async (key) => {
    const opt = optionFor(key);
    set({ font: key, regularFamily: opt.regular, boldFamily: opt.bold });
    try {
      const db = getDatabase();
      await setSetting(db, SETTING_KEY, key);
    } catch {
      // Persistence is best-effort — in-memory selection still applies.
    }
  },
  hydrate: async () => {
    try {
      const db = getDatabase();
      const saved = (await getSetting(db, SETTING_KEY)) as AppFontKey | null;
      if (!saved) return;
      const opt = optionFor(saved);
      set({ font: saved, regularFamily: opt.regular, boldFamily: opt.bold });
    } catch {
      // DB may not be ready yet; MainAppShell calls hydrate() after init.
    }
  },
}));
