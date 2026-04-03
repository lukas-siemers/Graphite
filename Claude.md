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

## Phase 1 — iPad MVP (weeks 1–8)

**Goal:** A fully functional local note-taking app on iPad. No backend. App Store ready.

### Deliverables

- [x] Expo SDK 54 project scaffold with Expo Router v3 and TypeScript
- [x] Root monorepo `package.json` with yarn workspaces
- [x] SQLite schema + migration runner (`expo-sqlite`)
- [x] Zustand stores: `useNotebookStore`, `useNoteStore`, `useFolderStore`
- [x] Three-column iPad layout (sidebar 220px + note list 280px + editor fills rest)
- [x] Phone layout: tab-based navigation (sidebar → list → editor)
- [ ] Sidebar component:
  - [x] App logo + "Graphite" wordmark
  - [x] Notebook list with expand/collapse
  - [x] Folder tree with active state (tangerine accent)
  - [x] "New Note" pill button
  - [x] User avatar + settings icon at bottom
- [ ] Note list component:
  - [x] Search bar (SQLite FTS5)
  - [x] Note cards with title, preview, timestamp
  - [x] Active card left-border accent
  - [x] Sort: last edited
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
- [ ] iPad-optimized layout (landscape + portrait)
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

- [ ] `apps/desktop` Electron project
- [ ] Expo Web build pipeline (`expo export --platform web`) feeding Electron's `BrowserWindow`
- [ ] `better-sqlite3` local DB in Electron main process, mirroring mobile schema
- [ ] `contextBridge` IPC layer — renderer never imports Node APIs directly
- [ ] Auto-updater (`electron-updater`) with GitHub Releases as update server
- [ ] Deep link handler: `graphite://auth/callback` for OAuth redirect
- [ ] Drawing canvas: `tldraw` (web-compatible) replacing `react-native-skia`
- [ ] `<DrawingCanvas>` abstraction component — platform check swaps implementation
- [ ] macOS code signing + notarization (Apple Developer account required)
- [ ] Windows NSIS installer
- [ ] GitHub Actions CI/CD:
  - [ ] On push to `main`: build macOS `.dmg` + Windows `.exe`, attach to GitHub Release
  - [ ] Run Vitest on every PR
- [ ] Sync parity: desktop participates in exact same sync engine as iPad

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
