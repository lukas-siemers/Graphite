# Graphite — Project Intelligence

This file is the source of truth for Claude when working on this codebase. Read it at the start of every session before writing any code.

---

## What is Graphite

Graphite is a cross-platform markdown note-taking app inspired by Obsidian. It targets iPad (Apple Pencil) as the primary platform and desktop (Electron) as secondary. Notes are stored locally by default. Cross-device sync is the paid feature.

---

## Tech stack

| Layer | Technology |
|---|---|
| Mobile | React Native + Expo SDK 54 |
| Desktop | Electron + Expo for Web |
| Editor | Markdown-based, CodeMirror 6 via WebView |
| Drawing | react-native-skia (iPad), tldraw (desktop) |
| Local DB | expo-sqlite (mobile), better-sqlite3 (desktop) |
| Backend | Supabase (Postgres, Realtime, Storage, Auth) |
| State | Zustand |
| Navigation | Expo Router v3 |
| Payments | StoreKit 2 via expo-iap (iOS), Stripe (web, future) |
| Testing | Vitest (unit), Detox (E2E) |

---

## Monorepo structure

```
Graphite/
├── apps/
│   ├── mobile/        # Expo React Native (iPad primary)
│   └── desktop/       # Electron wrapper
├── packages/
│   ├── ui/            # Shared React Native components
│   ├── editor/        # Markdown editor
│   ├── sync/          # Supabase sync engine
│   └── db/            # SQLite schema + migrations
├── supabase/
│   ├── migrations/
│   └── functions/
├── CLAUDE.md
└── package.json
```

---

## Color system

| Token | Value | Usage |
|---|---|---|
| `bgBase` | `#1E1E1E` | Main background |
| `bgSidebar` | `#252525` | Left sidebar |
| `bgHover` | `#2C2C2C` | Hover states |
| `bgDeep` | `#141414` | Code block bg |
| `border` | `#333333` | All panel borders (1px) |
| `textPrimary` | `#FFFFFF` | Headings, titles |
| `textBody` | `#DCDDDE` | Body text |
| `textMuted` | `#8A8F98` | Labels, timestamps |
| `textHint` | `#555558` | Placeholders, status bar |
| `accent` | `#F28500` | Tangerine — active states, FAB, borders |
| `accentLight` | `#FFB347` | Accent text on dark tint |
| `accentPressed` | `#D4730A` | Pressed accent |
| `accentTint` | `#2C1800` | Accent background tint |

Design vibe: sharp, flat, developer-tool-like (Linear + VS Code). No gradients, no shadows, no decorative elements.

---

## Database schema (local SQLite)

```sql
CREATE TABLE notebooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  synced_at INTEGER
);

CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id),
  parent_id TEXT REFERENCES folders(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  folder_id TEXT REFERENCES folders(id),
  notebook_id TEXT NOT NULL REFERENCES notebooks(id),
  title TEXT NOT NULL DEFAULT 'Untitled',
  body TEXT NOT NULL DEFAULT '',
  drawing_asset_id TEXT,
  is_dirty INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  synced_at INTEGER
);

-- Full-text search virtual table
CREATE VIRTUAL TABLE notes_fts USING fts5(
  title,
  body,
  content='notes',
  content_rowid='rowid'
);
```

All IDs use nanoid. All timestamps are Unix ms integers.

---

## Monetization

| Tier | What you get | Price |
|---|---|---|
| Free | Full local note-taking, folders, Apple Pencil drawing | $0 |
| Pro | Cross-device sync, cloud backup | $4.99/mo or $39.99/yr |

Sync is the paywall. Supabase client is never initialized for free users.

---

## Sync rules

- Offline first — all writes go to SQLite, sync runs in background
- Delta sync — only notes where `is_dirty = 1` are pushed on reconnect
- Conflict resolution — last-write-wins on `updated_at` (CRDT via Yjs planned for v2)
- Drawings — stored as JSON stroke arrays locally, uploaded as `.json` blobs to Supabase Storage

---

## Target Product Vision

### Finalized product decisions (v1.5 canvas model)

| Decision | Finalized |
|---|---|
| Input switching | Automatic — Apple Pencil detected = draw mode, finger = scroll/pan. No manual toggle needed. Palm rejection enabled. |
| Text model | Flowing — one continuous text column from top, reflowing within fixed width |
| Canvas geometry | Fixed-width column, infinite vertical scroll. Ink may extend into margins. |
| Existing notes | Silent auto-convert on first open — wrap body string in canvas text object |
| Finger drawing | Off by default. Future settings toggle. |
| File import (.md etc) | Phase 4 |
| Canvas width | Fixed page width with margins (exact value TBD at implementation time) |

---

The goal is a note-taking app that feels like **one endless piece of paper** — you type, you draw with Apple Pencil, you scroll down forever. No switching between "text mode" and "drawing mode". No separate files.

### Endless note (infinite vertical scroll)
Notes scroll infinitely downward. There is no bottom. The user always has more space below — for more text, more sketches, more thoughts. This is the "roll of paper" metaphor. The note renderer has no fixed height; the scroll view grows dynamically as content is added.

### Canvas-first architecture
The note surface is a **unified coordinate-space canvas**, not an ordered array of blocks. Typed text and Apple Pencil ink coexist on the same surface at the same time — you can type a word and draw next to it on the same line. This is the Notability/GoodNotes model, not a block editor.

The previous block-based `NoteDocument` schema (ordered `markdown` + `drawing` block array) is **superseded** by this canvas-first model.

### Two layers on the canvas

Every note canvas has two layers rendered on top of each other:

1. **Ink layer** — Apple Pencil strokes. Implemented with `react-native-skia` on iPad and `tldraw` on desktop/web. Strokes carry pressure and tilt data.
2. **Content layer** — positioned content objects, each with an `(x, y)` coordinate and a size on the canvas. Content types:
   - Typed text objects
   - Code blocks (syntax-highlighted, with a copy button)
   - Images — future feature (Phase 4)
   - Wikilinks — future feature (Phase 5, see below)

Both layers share the same coordinate space. The ink layer renders below the content layer so ink can flow around or behind typed text.

### Content types

| Type | Status | Notes |
|---|---|---|
| Typed text | Core | Free-positioned text objects on the canvas |
| Apple Pencil ink | Core | Pressure + tilt strokes, skia / tldraw |
| Code blocks | Core | Syntax-highlighted, copy button, positioned as content object |
| Images | Future (Phase 4) | Inline on canvas; stored as separate asset files |
| Wikilinks | Future (Phase 5) | `[[note name]]` or highlight-to-link; bidirectional; stored as link objects referencing note IDs |

### Storage model

`notes.body` (plain markdown string) and `notes.drawing_asset_id` are both **superseded**. The note row stores a `canvas_json` blob containing the full canvas document: ink strokes and all positioned content objects.

```
notes.canvas_json  — replaces both notes.body and notes.drawing_asset_id
```

Large assets (images, future) are stored as separate asset files and referenced by ID from within `canvas_json`. Ink strokes and text objects are stored inline in the blob.

**Markdown is no longer the primary format.** The canvas document is the source of truth. Markdown export remains a planned feature in Phase 4.

**Migration path (v1.5):**
1. Add `canvas_json TEXT` column (nullable) alongside existing `body` and `drawing_asset_id`
2. On first open of a legacy note, convert `body` text → a single positioned text object at the canvas origin; preserve `drawing_asset_id` strokes in the ink layer
3. After full migration, drop `body` and `drawing_asset_id` in a later migration

**Why this matters for sync:** ink layer changes and content layer changes are independent deltas within `canvas_json`. The sync engine (Phase 2) is built on this model — do not build sync against the old `body` + `drawing_asset_id` schema.

### Platform implementations

| Platform | Ink layer | Content layer |
|---|---|---|
| iPad (mobile) | `react-native-skia` | React Native positioned views |
| Desktop / Web | `tldraw` | Web DOM positioned elements |

The `<DrawingCanvas>` abstraction component already performs the platform check. The canvas-first model extends this: the abstraction must expose both layers uniformly.

### Timing
Implement the canvas-first data model and `canvas_json` migration before Phase 2 sync is built. Sync must be designed against the final `canvas_json` schema, not the legacy `body` field.

---

## Phase 1 — iPad MVP (weeks 1–8)

**Goal:** A fully functional local note-taking app on iPad. No backend. App Store ready.

### Deliverables

- [x] Expo SDK 54 project scaffold with Expo Router v3 and TypeScript
- [x] Root monorepo `package.json` with yarn workspaces
- [x] SQLite schema + migration runner (`expo-sqlite`)
- [x] Zustand stores: `useNotebookStore`, `useNoteStore`, `useFolderStore`
- [x] Three-column iPad layout (sidebar 220px + note list 280px + editor fills rest)
- [x] Phone layout: tab-based navigation (sidebar → list → editor)
- [x] Sidebar component:
  - [x] App logo + "Graphite" wordmark
  - [x] Notebook list with expand/collapse
  - [x] Folder tree with active state (tangerine accent)
  - [x] "New Note" pill button
  - [x] User avatar + settings icon at bottom
- [x] Note list component:
  - [x] Search bar (SQLite FTS5)
  - [x] Note cards with title, preview, timestamp
  - [x] Active card left-border accent
  - [x] Sort: last edited
  - [ ] Delete note — swipe or long-press to delete, confirmation prompt
  - [ ] Delete folder — long-press in sidebar, only allowed when folder is empty or with confirmation to also delete contents
  - [ ] Delete notebook — long-press in sidebar, confirmation required, deletes all contained notes and folders
  - [ ] New note UX — investigate and fix odd behavior when creating a new note (reported by user)
- [x] Markdown editor component:
  - [x] Title input (28px, no border)
  - [x] Breadcrumb below title
  - [x] Toolbar: Bold, Italic, H1, Code, Link, Draw toggle
  - [x] Live markdown rendering
  - [x] Syntax-highlighted code blocks
  - [x] Word count + save status in bottom bar
- [x] Apple Pencil drawing canvas (`react-native-skia`):
  - [x] Pressure + tilt sensitivity
  - [x] Pen / eraser / selection tools
  - [x] Stroke serialized as compact JSON array
  - [x] Linked to note via `drawing_asset_id`
  - [x] Floating FAB button (tangerine circle, pencil icon) to toggle canvas
- [x] Full-text search with SQLite FTS5
- [x] Offline-first: zero network calls in Phase 1
- [x] App icon, splash screen (`#1E1E1E` background)
- [ ] iPad-optimized layout (landscape + portrait) — deferred; current layout is a temporary implementation, full UI redesign pass planned before TestFlight submission
- [ ] TestFlight build + App Store submission

### Key rules for Phase 1
- No Supabase imports anywhere — not even installed
- All IDs generated with `nanoid` at creation time
- `updated_at` stored as `Date.now()` (Unix ms)
- `is_dirty` always `0` in Phase 1 (no sync needed yet)

---

## Phase 2 — Auth, sync engine & paywall (weeks 9–12)

**Goal:** Add Supabase backend, accounts, and StoreKit 2 subscription paywall.

### Deliverables

- [ ] Supabase project created (auth, Postgres, Storage, Realtime)
- [ ] Email + Google OAuth login screens
- [ ] Supabase Auth session management (stored in SecureStore)
- [ ] Postgres schema matching local SQLite schema
- [ ] Row Level Security policies on all tables:
  - `FOR ALL USING (auth.uid() = user_id)`
- [ ] `packages/sync` — sync engine:
  - [ ] Push: find all `is_dirty = 1` notes → upsert to Supabase
  - [ ] Pull: subscribe to Supabase Realtime channel per `user_id`
  - [ ] Conflict: compare `updated_at`, keep whichever is newer
  - [ ] Drawing upload: serialize strokes → `.json` → Supabase Storage
  - [ ] Mark `is_dirty = 0` and write `synced_at` after successful push
- [ ] Sync engine only starts after subscription confirmed
- [ ] StoreKit 2 integration (`expo-iap`):
  - [ ] Monthly product: `com.graphite.pro.monthly`
  - [ ] Annual product: `com.graphite.pro.annual`
  - [ ] Subscription check on every app foreground
  - [ ] Paywall screen shown when sync attempted on free tier
- [ ] `settings` table in SQLite caching subscription state
- [ ] Account settings screen: logout, manage subscription
- [ ] Supabase Edge Function webhook: App Store server notifications → update subscription record

### Key rules for Phase 2
- Supabase client instantiated only inside `packages/sync`, never in UI components
- Free users never touch any network call related to sync
- Always re-verify subscription with StoreKit on launch — never trust cache alone
- Realtime channel scoped to `user_id`, not per-note (prevents channel explosion)

---

## Phase 3 — Electron desktop app (weeks 13–16)

**Goal:** macOS and Windows desktop app sharing the mobile codebase, syncing via Supabase.

### Deliverables

- [x] `apps/desktop` Electron project
- [x] Expo Web dev pipeline (Metro dev server feeding Electron `BrowserWindow` — dev mode working)
- [ ] Expo Web production build pipeline (`expo export --platform web`) feeding Electron's `BrowserWindow` in prod
- [x] `better-sqlite3` local DB in Electron main process, mirroring mobile schema
- [x] `contextBridge` IPC layer — renderer never imports Node APIs directly (10 IPC handlers via `wrap<T>()` helper)
- [ ] Auto-updater (`electron-updater`) with GitHub Releases as update server
- [x] Deep link handler: `graphite://auth/callback` for both macOS (`open-url`) and Windows (`second-instance`)
- [x] Drawing canvas: `tldraw` (web-compatible) replacing `react-native-skia`
- [x] `<DrawingCanvas>` abstraction component — platform check swaps implementation
- [ ] macOS code signing + notarization (Apple Developer account required)
- [ ] Windows NSIS installer
- [ ] GitHub Actions CI/CD:
  - [ ] On push to `main`: build macOS `.dmg` + Windows `.exe`, attach to GitHub Release
  - [ ] Run Vitest on every PR
- [ ] Sync parity: desktop participates in exact same sync engine as iPad

### Expo Web pipeline notes (as of 2026-04-03)
Dev mode is working: Metro bundles the Expo app and Electron loads it via `http://localhost:8081`. Key infrastructure in place:
- `apps/mobile/metro.config.js` — web stubs via `extraNodeModules` for native-only packages; `unstable_enablePackageExports = false` (critical for CJS resolution)
- `apps/mobile/stubs/` — stubs for react-native-skia, react-native-worklets-core, expo-file-system, expo-sqlite, tldraw, nanoid
- `apps/mobile/babel.config.js` — `babel-plugin-transform-import-meta`
- `packages/db/src/migrations.ts` — platform guard skips expo-sqlite on web, returns `noopDb`
- Production export (`expo export --platform web`) is not yet wired to Electron's prod load path

### Key rules for Phase 3
- All Node.js APIs (fs, sqlite, shell) live exclusively in `electron/main.ts`
- Renderer is a pure web context — treat it like a browser
- Never import `better-sqlite3` in the renderer process

---

## Phase 4 — Web app + polish (weeks 17–24)

**Goal:** Web-accessible tier, Stripe billing, and product hardening.

### Deliverables

- [ ] Web app at `app.graphite.io` (Next.js or Expo Web standalone)
- [ ] Stripe integration for web/desktop subscriptions
- [ ] Unified billing: StoreKit on iOS, Stripe on web/desktop
- [ ] Markdown export (`.md` file download)
- [ ] PDF export (note → PDF with embedded drawing image)
- [ ] Public note sharing: unique read-only URL, no account required
- [ ] Tag system: `#tag` syntax in note body, filterable in sidebar
- [ ] Fuzzy search upgrade (beyond FTS5)
- [ ] Onboarding flow: welcome screens, sample notebook pre-loaded
- [ ] Analytics: PostHog (self-hosted or cloud, privacy-respecting)
- [ ] In-app feedback widget
- [ ] Referral / word-of-mouth mechanism
- [ ] Inline rename for folders and notebooks — double-click on the title in the sidebar to edit it in place
- [ ] Move notes between folders within a notebook (drag or context menu)
- [ ] Move notes between notebooks
- [ ] Reorder notebooks in the sidebar
- [ ] Auto-delete empty notes — notes with no title and no content are silently deleted when the user navigates away

---

## Phase 5 — AI features (future, unscheduled)

**Goal:** Premium AI features as a tier differentiator.

### Ideas (not committed)

- [ ] Note summarization via Claude API (`claude-sonnet` model)
- [ ] Smart auto-tagging from note content
- [ ] Semantic search across all notebooks (embeddings)
- [ ] Sketch → Mermaid diagram conversion
- [ ] "Chat with your notes" — RAG over personal knowledge base
- [ ] AI writing assistant inline in the editor

---

## Conventions

- Files: `kebab-case`
- Components: `PascalCase`
- Functions / variables: `camelCase`
- DB columns: `snake_case`
- Supabase tables: plural `snake_case` (`notes`, `notebooks`, `folders`)
- Commits: Conventional Commits — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`
- Branches: `feat/name` or `fix/name` branched off `dev`
- `dev` → `main` only for release builds

---

## Environment variables

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # server / edge functions only — never in client bundle
```

Never commit secrets. Use `.env.local` (already in `.gitignore`).

---

## Useful references

- Expo SDK 54 changelog: https://expo.dev/changelog/sdk-54
- Expo Router v3 docs: https://expo.github.io/router/docs
- react-native-skia: https://shopify.github.io/react-native-skia/
- Supabase RLS guide: https://supabase.com/docs/guides/auth/row-level-security
- expo-iap (StoreKit 2): https://github.com/dooboolab-community/expo-iap
- better-sqlite3: https://github.com/WiseLibs/better-sqlite3
- tldraw: https://tldraw.dev
