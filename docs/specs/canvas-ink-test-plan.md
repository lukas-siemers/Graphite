# Canvas Ink — Perfect-Freehand Slice 1 Test Plan

Owner: QA
Status: Draft — SWE-1 is implementing `feat/canvas-ink-perfect-freehand`; tests below are spec'd now and will be authored + run once SWE-1's PR lands.

## Scope of Slice 1

Swap the ink rendering path inside `packages/editor/src/CanvasRenderer.tsx` `InkLayerView` from naive `M`/`L` SVG segments to `perfect-freehand`-generated outline polygons. No changes to:

- Stroke storage shape (`InkStroke` / `StrokePoint` in `packages/db/src/canvas-types.ts`)
- The gesture stack driving `handleInkStart` / `handleInkMove` / `finishInkStroke`
- `inputMode: 'ink' | 'scroll'` toggle
- Legacy `DrawingCanvas.tsx` modal
- Legacy body migration in `use-note-canvas-migration.ts`
- Markdown or PDF export
- FTS5 index, which never saw ink in the first place

## Test Targets

### 1. Unit tests — `packages/editor/src/__tests__/strokeToOutlinePath.test.ts` (Vitest)

SWE-1 is extracting a pure function:

```ts
export function strokeToOutlinePath(stroke: InkStroke): string
```

It wraps `perfect-freehand`'s `getStroke()` + a local svg-d formatter and returns a single SVG path string that Skia's `Path.MakeFromSVGString` can parse. Being pure and Skia-free makes it the seam QA tests against.

Because SWE-1's branch is not committed yet, do not write the test file in this turn — just the spec. Author after SWE-1 merges the pure function.

#### Test cases

| # | Case | Input | Expected observable behavior |
|---|---|---|---|
| 1 | Empty stroke | `points: []` | Returns `""` (empty string). No throw, no NaN in output. |
| 2 | Single point | `points: [{x:10,y:10,pressure:0.5,tilt:0,timestamp:0}]` | Returns a non-empty, valid SVG path. Perfect-freehand renders a circular dot outline for a 1-pt stroke; assert the returned string starts with `M` and contains at least one close command (`Z`). |
| 3 | Straight line, uniform pressure | Two points, same pressure `0.5`, 100px apart | Returns a non-empty, closed path. Assert: starts with `M`, ends with `Z`, contains at least 4 distinct vertices (outline is a filled quad-ish shape, not a zero-width line). |
| 4 | Pressure gradient low → high | 10 points, pressure `0.1 → 1.0` monotonic | Outline width at the end point is measurably greater than at the start. Operational assertion: parse the path commands, extract all vertex positions, and assert the cross-stream width at the last point > width at the first point. |
| 5 | Pressure gradient high → low | Reverse of case 4 | Symmetric to case 4 — start wider than end. |
| 6 | Uniform zero-ish pressure | 10 points, all pressure `0.0` | Does not return `""`. Minimum stroke width is still positive (perfect-freehand `thinning` config guarantees a floor). This guards against the "invisible stroke" regression where pressure 0 collapses output. |
| 7 | Tilt field ignored (current behavior) | 10 points, varying `tilt` | Output is identical when only tilt changes and everything else is constant. Lock this in so if we later add tilt-aware rendering we see the test flip explicitly. |
| 8 | Path string is Skia-parseable | Any valid stroke | The returned string matches `/^M [-0-9.]+ [-0-9.]+/` and contains no `NaN`, `undefined`, `Infinity`. This is the cheap guard-rail that prevents a malformed-input case from reaching Skia where it silently renders nothing. |
| 9 | Closed path | Any >= 2-point stroke | Returns a path that ends with `Z` (perfect-freehand outlines are closed polygons, not open curves). If SWE-1's formatter drops the close command, Skia will fill-rule the outline incorrectly. |
| 10 | Deterministic output | Same input called twice | Returns bit-identical strings. No `Math.random`, no `Date.now`. Re-run in `vi.useFakeTimers()` to confirm. |
| 11 | Large stroke smoke | 1000 points | Does not throw, returns a string with length > 100. No perf assertion — this is just a "doesn't blow the stack" check. |

#### Determinism rules (from CLAUDE.md QA rules)

- `vi.useFakeTimers()` wrapping every test to freeze `Date.now()`.
- `vi.mock('nanoid', () => ({ nanoid: () => 'test-id' }))` if the unit under test ever generates an id (it shouldn't for a pure path function).
- No network, no filesystem, no Skia — `strokeToOutlinePath` must be a pure import that runs in a jsdom or node Vitest environment. Skia is never imported on the test path.

### 2. Component-level sanity — `CanvasRenderer.test.tsx` (new, Vitest + React Testing Library if the package already configures it, otherwise skipped at this slice)

Note: the editor package currently has NO RTL setup, only pure-function tests in `applyFormat.test.ts`. Do not add one for Slice 1. Component coverage stays in manual smoke.

### 3. Package regression — existing suites

Before merging Slice 1, re-run and require green:

- `yarn workspace @graphite/editor test` — must stay at 24/24 (applyFormat parity suite + shared-source drift guard).
- `yarn workspace @graphite/db test` — must stay at 44/44 (migrations, notes CRUD, tags, FTS5).
- Root `yarn test` — must stay at the current 269-tests-green baseline. Any red is a block.

The editor and db suites do not touch stroke rendering, so the expected result is "nothing changes." This is the drift detector — if either suite newly fails, SWE-1 touched something outside scope.

## Manual smoke — TestFlight / dev-client (iPad, standalone build)

Per `CLAUDE.md` "iOS production startup trap" rules and QA memory `feedback_qa_native_awareness.md`:

> "works in Expo Go" does NOT prove the production startup path is safe.

Slice 1 adds a JS dep and changes the rendering inner loop of a native-heavy component. It is NOT a config or plugin change, so the startup-path risk is low — but the cold-boot probe is still mandatory because Slice 1 ships on a branch that may merge alongside other drift.

### Pre-flight (run before SWE-1 opens their PR)

1. [ ] `yarn install` at repo root runs cleanly and populates `node_modules/perfect-freehand/dist/cjs/index.js` with real code (not an empty dir). Verify with `ls -la node_modules/perfect-freehand/dist/cjs/`.
2. [ ] `yarn workspace @graphite/mobile tsc --noEmit` is clean.
3. [ ] `npx expo prebuild --platform ios` (if required by the dev-client flow) completes without new warnings tied to `perfect-freehand`.

### Cold boot — dev-client build

1. [ ] App launches cold on iPad with the dev-client build. Splash → first route renders text within 3s. No black-screen regression.
2. [ ] Build number in `apps/mobile/app.json` is bumped. This is QA's merge gate — any startup-path merge without a build bump is a block on principle.

### Existing notes with ink

1. [ ] Open an existing note that already has ink strokes (created against the old M/L renderer, persisted in `canvas_json`).
2. [ ] Strokes render. They should look thicker and tapered vs. the old M/L rendering — this is the intended visual upgrade.
3. [ ] No strokes vanish, no strokes double up, no wrong-color strokes. The stored `InkStroke.color` / `width` / `opacity` still drive the visual.

### New stroke — Apple Pencil

1. [ ] Toggle `inputMode` to `'ink'` (however Slice 1 exposes this — even a hardcoded toggle in a dev-only debug menu is acceptable; this gets replaced in Slice 2).
2. [ ] Draw a slow stroke with varying Pencil pressure. Confirm the outline width visibly responds to pressure changes end-to-end.
3. [ ] Draw a fast stroke. Confirm no missed points, no jagged corners (perfect-freehand's internal smoothing should handle this — if it looks worse than the old M/L, flag it).
4. [ ] Draw a single tap (1 point). Confirm a round dot renders, not nothing.
5. [ ] Draw 50+ strokes. Confirm no visible frame drops while drawing the 51st (cheap perf gut check — not a gated metric).

### Persistence

1. [ ] Close and reopen the note. All strokes render identically, in the same positions, same widths, same colors.
2. [ ] Background the app and return. Strokes survive. This is the `canvas_json` save path working.
3. [ ] Force-quit the app, relaunch. Strokes survive.

### Export

1. [ ] Markdown export on a note with ink: the exported `.md` contains NO ink references, NO SVG path strings, NO stroke JSON. Markdown is text-only by design.
2. [ ] PDF export on a note with ink: the exported `.pdf` contains the typed text. Ink embedding in PDFs is a future feature — confirm it's absent, not half-wired.

### FTS5

1. [ ] Create a note with ink + the body text "perfect freehand smoke test".
2. [ ] Run full-text search for `freehand`. The note must appear in results. This confirms ink rendering changes did not accidentally break the text write path or orphan the FTS index.
3. [ ] Delete the note. Search for `freehand` again — no hits, no orphan rows.

### Legacy DrawingCanvas modal

Slice 1 does NOT touch `apps/mobile/components/drawing/DrawingCanvas.tsx`. It still ships, still uses its own M/L renderer.

1. [ ] If any code path still opens the legacy modal (via the FAB or a legacy note), it must continue to render. Draw a stroke in the modal, save, confirm it persists to the legacy `drawingAssetId` path, reopen, confirm it renders.

This is a "does not regress" gate, not a feature gate.

## Unified canvas interaction matrix — Slice 2 regression backstop (document only, do not run in Slice 1)

Slice 2 will remove the `inputMode` gate entirely and enable automatic Pencil-vs-finger detection. Everything below is the "what could break when the gate comes out" reference, written here so QA has a regression backstop ready when Slice 2 lands.

### Input pairs

| Touch type | Expected action |
|---|---|
| Apple Pencil down, move, up | Ink stroke drawn. Keyboard does not open. |
| Finger down, move, up | Page scrolls. No ink drawn. |
| Finger tap on word | Cursor placed in CodeMirror. Keyboard opens. |
| Apple Pencil tap on word | Ink dot drawn at the tap location. Keyboard does NOT open. Cursor position unchanged. |
| Finger long-press | OS text-selection handles appear (CodeMirror selection). |
| Apple Pencil long-press | Ink dot drawn (a stationary pencil is still a stroke). No selection handles. |
| Simultaneous finger-scroll + Pencil ink | Pencil wins the ink layer, finger still scrolls the canvas. This is the "palm rejection" case. |
| Two-finger pinch | Reserved — not in scope; palm-rejection must not accidentally enable a stroke. |

### State overlap

| Scenario | Expected behavior |
|---|---|
| User is typing, Pencil comes down mid-word | Pencil ink renders on the canvas. Cursor does not jump. The in-flight text edit is not interrupted. |
| User is drawing, soft keyboard was already open | Keyboard stays open. Ink renders underneath the keyboard's vertical zone (inside the visible scroll area). |
| User is drawing, rotates device | Ink coordinates stay anchored to the logical canvas (not to screen space). Existing strokes do not shift. |
| User backgrounds mid-stroke | Active stroke is committed on background, same as `onResponderTerminate` today. |
| Note list open (phone layout) + switch notes | New note renders with its own ink layer. No "bleed-through" from the previous note's active stroke. |

### Save path

| Scenario | Expected behavior |
|---|---|
| 1 stroke drawn, no text edit | `canvas_json` updated, `body` unchanged, `is_dirty=1`. |
| 1 stroke + 1 text edit | Both persisted in the same save. FTS5 reflects the new body. |
| Stroke drawn on a brand-new empty note | Note is NOT auto-deleted on navigate-away. Auto-delete only fires for notes with empty body AND empty ink layer. (Verify this rule survives Slice 2 — currently `auto-delete empty notes` may only check body.) |
| Stroke drawn on an existing note, then all text deleted | Note is NOT auto-deleted. Ink alone is valid content. |

### Export Slice 2 re-run

Repeat the Slice 1 export checks. The rule does not change: ink stays out of markdown, ink stays out of PDF at Slice 2. Actual ink-in-PDF is Phase 4.

## Recommendation order of operations

1. SWE-1 runs a clean `yarn install`, verifies `perfect-freehand` resolves, and writes the pure `strokeToOutlinePath` function.
2. SWE-1 exports `strokeToOutlinePath` from `packages/editor/src/` so it is directly importable by the Vitest suite.
3. QA authors `packages/editor/src/__tests__/strokeToOutlinePath.test.ts` against that export.
4. QA runs the full Vitest suite (editor + db + root) to confirm no drift.
5. QA runs the manual smoke on a dev-client iPad build.
6. Only then does SWE-1's PR merge to `main`.

## Concerns flagged for SWE-1

1. `node_modules/perfect-freehand/dist/` is currently empty on the dev machine — see audit report. SWE-1 must re-install before writing code or every import will fail at runtime.
2. `apps/mobile/package.json` already declares `perfect-freehand@^1.2.3` but `yarn.lock` does NOT record a resolution for it. SWE-1 must commit both the `package.json` change AND the lockfile update in the same PR, otherwise CI will fail on a fresh checkout.
3. Keep `perfect-freehand` as an import of the pure API (`import { getStroke } from 'perfect-freehand'`). Do NOT import `perfect-freehand/dist/...` subpaths — `unstable_enablePackageExports = false` in `metro.config.js` means subpath resolution is unreliable.
4. The extracted `strokeToOutlinePath` function must not `require('@shopify/react-native-skia')`. The whole point of the extraction is that it is Skia-free and therefore Vitest-testable in a node environment. Skia conversion stays inside `InkLayerView`.
5. The `perfect-freehand` options (`size`, `thinning`, `smoothing`, `streamline`, `simulatePressure`) should be exposed as named constants at the top of `CanvasRenderer.tsx` or a sibling file, not inlined — QA needs a stable import target for future tuning tests and for the Slice 2 "same input, same output" drift guard.
