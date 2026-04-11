# Canvas Ink UX — Unified Text + Pencil Surface

**Status:** Approved for implementation (Phase 1 follow-up)
**Owner:** Designer
**Consumers:** SWE-1 (native — `packages/editor/src/CanvasRenderer.tsx`, `apps/mobile/components/editor/Editor.tsx`, `apps/mobile/components/editor/FormattingToolbar.tsx`)
**Scope:** iPad (React Native + Skia) only. Desktop/web unchanged this pass.
**Aesthetic:** The Digital Monolith — brutalist, 0px radius, tonal stacking, no shadows, mechanical interaction.

---

## 1. Core principle

The note page is a single surface. Typed text and Apple Pencil ink coexist in the same coordinate space. **Input type decides the interaction — not a mode toggle.**

- Apple Pencil → ink (draws strokes on top of text)
- Finger → text and scroll (caret, selection, scroll, tap targets)

There is no "drawing mode" button. The `canDraw = inputMode === 'ink'` gate in `CanvasRenderer.tsx` is removed. The `inputMode` prop and the editor store's mode state are deleted. Ink capture and text entry run simultaneously at all times, routed by pointer type.

---

## 2. Interaction behavior

### 2.1 Pointer routing rule

Every touch carries a `touchType` on iOS: `direct` (finger), `stylus` (Pencil), `indirect` (trackpad / mouse — not applicable here). The responder layer inspects `nativeEvent.touchType` (or the equivalent Pencil marker from `react-native-skia`'s touch handler) on `onStartShouldSetResponder` and decides:

| Pointer | Routes to |
|---|---|
| `stylus` | Ink layer (Skia capture) |
| `direct` | Text layer (WebView / scroll) |

This is a hard split — the ink layer returns `false` from `onStartShouldSetResponder` for any non-stylus touch, letting the event fall through to the WebView beneath.

### 2.2 Interaction table

| # | Case | Behavior |
|---|---|---|
| 1 | **Pencil tap on body text** | Start a new ink stroke at the tap point. Zero-length taps (touch-down immediately followed by touch-up) commit as a single dot (single-point stroke rendered as a filled circle at `size * pressure`). Text caret is untouched. |
| 2 | **Pencil tap on the title TextInput** | **Title area is ink-forbidden.** The title band (defined in 4.3 below) swallows stylus events and does nothing — no stroke captured, no caret moved, no visual feedback. The title is page metadata, not canvas content; ink above it would pollute the note list previews and break the editorial header. Rationale: Lukas explicitly said the title stays as-is, and the existing title text styling (28px, `textPrimary`, 700) is not designed to live under ink. |
| 3 | **Pencil tap inside an active text selection** | Selection is preserved. Ink stroke starts normally. Rationale: selections are owned by the finger/keyboard path; stylus and finger are orthogonal tools, so a pencil touch must not disturb text state. If the user then taps with a finger outside the selection, the selection clears per existing text behavior. |
| 4 | **Pencil tap on a fenced code block COPY button** | **Ink wins.** The COPY button is inside the WebView; the ink layer sits on top of it in z-order, so a stylus touch captures a (likely tiny) stroke over the button. We accept this: COPY is a secondary action used rarely, and users tapping UI chrome with a $130 pencil is a self-inflicted edge case. If a stroke is shorter than 4px total path length AND the touch lands inside a known UI hit-zone (COPY button bounding rect, reported by the WebView via postMessage), the stroke is discarded and the tap is forwarded to the button. This is the only exception — we do not build a general hit-test table. |
| 5 | **Pencil tap on the scroll bar region** | No scroll bar is rendered (`showsVerticalScrollIndicator={false}`). The outer ScrollView's `scrollEnabled` is always `true` (we no longer toggle it by input mode), but stylus touches never reach the ScrollView because the ink layer intercepts them first. A pencil "drag down" produces a stroke, not a scroll. To scroll while holding a pencil, use the other hand with a finger. |
| 6 | **Pencil drag: text → margin → text** | One continuous stroke. The stroke is clipped to the canvas column width (680px) on render but the raw points are stored as captured — dragging into the margin and back should not break the stroke. Margin zone is `[-infinity, 0]` and `[680, +infinity]` on the X axis; points outside are kept in the data model (ink may extend into margins per the v1.5 canvas decision in CLAUDE.md) but visually clipped by the Skia canvas bounds of the layer. |
| 7 | **Finger tap on body text** | Caret moves as today. WebView receives the tap through the ink layer (which returned `false` for non-stylus). |
| 8 | **Finger drag in body area** | Scrolls the outer ScrollView. No ink captured. |
| 9 | **Finger tap on fenced code block COPY** | COPY fires as today. |
| 10 | **Finger long-press on body text** | Text selection as today. |
| 11 | **Hardware keyboard arrow key while Pencil is mid-stroke** | Stroke continues uninterrupted. The keyboard event reaches the WebView and moves the caret there. The two surfaces are independent. When the stroke releases, both states are intact. No cancellation, no "are you sure." |
| 12 | **Palm + Pencil simultaneously** | Palm rejection rule: if a `stylus` touch is active OR was active within the last 500ms, all concurrent `direct` touches are ignored by BOTH the ink layer and the text layer. The text layer ignores them by the responder returning `false` during an active stylus window. The 500ms window covers the lift-off jitter when the user finishes a word and plants their hand. |
| 13 | **Pencil tap on an existing ink stroke** | **This slice: no-op.** Treated identically to Case 1 — a new stroke starts, landing on top of the old one. Strokes stack. No hit-testing, no selection, no eraser-on-long-press. Eraser is explicitly out of scope for this slice (see 3.4). |
| 14 | **Pencil double-tap (Apple Pencil 2 gesture)** | Not bound in this slice. The system-level double-tap gesture (available in `UIPencilInteraction`) is not wired up. Reserved for a later slice where eraser toggling lands. Out of scope. |
| 15 | **Pencil tap below the end of the document** | If the stylus touches below the current `contentHeight`, the content layer auto-extends: the ScrollView's content container grows to accommodate the touch point plus a 200px buffer. This is the "infinite paper" rule. The stroke is captured at its real Y coordinate. |

---

## 3. Visual spec for ink

### 3.1 Default stroke color

**Decision: `textBody` (`#DCDDDE`).**

Alternatives considered:
- `accent` (`#F28500`) — rejected. Tangerine is owned by the selection pill and the FAB. Every stroke the user draws would scream "primary action." Ink is content, not chrome. Violates Monolith's rule that accent is reserved for final actions and active focus states.
- `textPrimary` (`#FFFFFF`) — rejected. Pure white reads as UI chrome on the `#131313` base; strokes would look like app-drawn overlays, not handwriting. Also too loud against the `#DCDDDE` body text — pencil lines would out-contrast the writing they annotate.
- `textMuted` (`#8A8F98`) — rejected. Too dim. Notes with lots of ink annotation would look washed out, and fine strokes at low pressure would disappear entirely against `#DCDDDE` body text.
- `textBody` (`#DCDDDE`) — **selected.** Same optical weight as body text, which is exactly right: ink is a peer to typing, not a highlight on top of it. A quick annotation sits at the same visual layer as the prose it comments on. Fine pressure variation stays visible because the tone sits clearly above `#131313` but does not fight `textPrimary` headings.

### 3.2 `perfect-freehand` parameters

Reference: `perfect-freehand` takes `{ size, thinning, smoothing, streamline, start, end, simulatePressure }`. iPad Pencil reports pressure in `[0, 1]`, typical writing range `0.2 – 0.8`, hard press `0.9+`.

```
size:              3.5
thinning:          0.55
smoothing:         0.62
streamline:        0.45
simulatePressure:  false   (use real Pencil pressure)
start: { taper: 0,  cap: true }
end:   { taper: 0,  cap: true }
```

Rationale:
- **`size: 3.5`** — a ballpoint-pen reference width, not a marker. Notes aren't sketches; this is annotation thickness. At default pressure (~0.5) this yields ~2.5px rendered width, roughly one-stroke of the 16px body text — ink and typing read as the same instrument.
- **`thinning: 0.55`** — Excalidraw uses 0.5–0.6 for pen feel; lower values flatten the pressure response. 0.55 gives a clear hairline-to-bold arc without exaggerating light presses.
- **`smoothing: 0.62`** — smooths the raw input noise without softening intentional corners.
- **`streamline: 0.45`** — mid-range; too low = jittery at fast speeds, too high = lag between pencil tip and stroke tail which readers notice.
- **`simulatePressure: false`** — we have real pressure data; never fake it. This also means finger-drawn strokes (if ever enabled) would render at constant width, which is fine as a secondary tool.
- **`taper: 0` both ends with `cap: true`** — rounded caps, no fake calligraphy taper. Consistent pen weight end-to-end matches the Monolith's "mechanical interaction" rule.

### 3.3 Color palette (3 colors, final)

Ink color is a property of the stroke. In this slice there is **no in-UI color picker** — all strokes use the default. The data model already has `stroke.color`, so future slices can introduce a picker without schema change. The palette below is what the picker will hold when it ships:

| # | Token | Role |
|---|---|---|
| 1 | `textBody` (`#DCDDDE`) | Default. Annotation ink. |
| 2 | `accent` (`#F28500`) | Emphasis ink — "this matters." Use sparingly, like a real pen cap swap. |
| 3 | `accentLight` (`#FFB77D`) | Highlight ink — for underlines or circled passages where the user wants a softer callout than full tangerine. |

Deliberately capped at **3**. A rainbow violates the Monolith's restraint; real pens come in small quantities. No blue, no green, no red. The existing code-block syntax palette has a one-off `#A8D060` and `#FF6B6B` — those are semantic tokens scoped to code highlighting and do **not** leak into ink.

### 3.4 Eraser — out of scope

Eraser does not ship in this slice. Strokes can only be added. Undo (text toolbar's existing `undo` command, Cmd+Z on keyboard) is **not** wired to ink undo in this slice either — they are independent stacks, and wiring text undo to also pop ink is a cross-layer change that needs its own design pass.

Follow-up slice will add eraser. When it lands: entered via Apple Pencil 2 double-tap (`UIPencilInteraction`), toggles an "eraser mode" that persists until a second double-tap, surfaced as a thin 1px tangerine underline on the status bar reading `ERASER` (uppercase, 11px, `letterSpacing: 0.5`). Not in this slice.

---

## 4. Toolbar and layout changes

### 4.1 Draw button removal

**Action:** Delete the Pencil-only right-side Draw button block in `FormattingToolbar.tsx` (the `Platform.OS !== 'web'` conditional wrapping the `onToggleDrawing` Pressable). The `onToggleDrawing` and `drawingOpen` props on `FormattingToolbarProps` are deleted. Callers in `Editor.tsx` stop passing them.

**Replacement:** Nothing. The slot is not refilled. The toolbar ends on the `link` button in Group 5, scroll area extends to the right edge with its existing `paddingRight: 8`. One fewer button, and the toolbar looks more balanced for it — the Draw button was a lonely right-aligned outlier that broke the left-aligned rhythm of the formatting groups.

### 4.2 Ink-captured indicator

**Decision: no indicator.**

Rationale: the stroke itself is the feedback. It appears on screen the instant the Pencil touches down and follows the tip with sub-frame latency (Skia direct rendering). Adding a toast, pulse, counter, or status-bar flash to "reassure" the user their stroke landed would (a) be chrome that contradicts the flat developer-tool aesthetic, (b) train the user to look away from their own handwriting to check a widget, (c) compete visually with the stroke rendering itself. The Monolith rule on mechanical interaction applies: the thing either happened or it didn't, and the thing is visible. Done.

### 4.3 Status bar

**Unchanged.** `N WORDS · M MIN READ · SAVED` stays exactly as it is. No ink metadata (stroke count, "X STROKES," ink-since-save indicator). Justifications considered and rejected:

- **Stroke count** — meaningless to the user. Nobody opens a note to see how many strokes they drew.
- **Ink-since-save dot** — redundant with `SAVED`/`SAVING...`. The existing status text already reflects unsaved state, and `onInkChange` triggers the same save pipeline as text edits, so `SAVING...` will flip correctly when the user lifts the pencil.
- **Ink present / absent icon** — a glyph in the status bar for "this note has drawings" is not needed inside the editor; the user literally sees their drawings above. An indicator in the note list preview is a separate design decision outside this spec.

### 4.4 Title strip (ink-forbidden zone)

The title area occupies the top of the editor as defined in `Editor.tsx`:

```
paddingTop:    20px
paddingBottom: 4px
title height:  ~34px (28px text + line-height)
breadcrumb:    ~28px (12px text + paddingBottom 12)
```

**The ink layer does not render in the title+breadcrumb strip.** Concretely, the ink layer is positioned absolutely over the **content area only** — the `CanvasRenderer` root, which starts below the breadcrumb. This is already the structural layout in `Editor.tsx`: the title, breadcrumb, and `CanvasRenderer` are sibling views; the ink layer lives inside `CanvasRenderer`. The fix is purely to make sure the removed `inputMode` gate does not accidentally extend the ink capture responder upward.

If the user's pencil touches inside the title TextInput's bounds, the responder chain resolves inside the title's view, not the ink layer — title touches never reach `CanvasRenderer`. No change needed; this is a natural outcome of the current layout.

---

## 5. Ink + text visual layering

### 5.1 Z-order (top to bottom)

1. Active stroke (in-flight, current pencil drag) — Skia layer, top
2. Committed strokes — Skia layer
3. CodeMirror text content (inside WebView) — base
4. `bgBase` (`#131313`) — editor background

The Skia canvas in `CanvasRenderer.tsx` already uses `StyleSheet.absoluteFill` on top of the text View. This is correct and unchanged.

### 5.2 Stroke opacity

**Decision: 100%. Full opacity.**

Alternatives considered:
- **90%** — would let text bleed through strokes, making ink feel like a highlighter. Rejected. Ink is a pen, not a highlighter. A ballpoint mark on paper is fully opaque; readers tolerate overlap with whatever's underneath.
- **85% with color blend** — rejected. Blending pen color with body text color creates a muddy middle value (`#DCDDDE` × `#DCDDDE` = no visible stroke). Any softening makes the default color unusable.
- **100%** — selected. If a user draws over their text, the ink is meant to obscure that text — that's the annotation intent. Undo still exists at the text level and ink strokes can be cleared in a future eraser pass.

The `stroke.opacity` field in the data model stays (it's already on `InkStroke`), default value `1.0`. Future slices can expose a per-stroke opacity setting if needed.

### 5.3 Ink and code fences

**Decision: ink renders on top of code fence backgrounds, same as on top of body text.**

The code fence background is `bgCode` (`#0E0E0E`) — the darkest surface in the token set. A `textBody` (`#DCDDDE`) stroke at 100% reads cleanly against it. Rendering ink *behind* code fences would require the Skia canvas to clip around the fence rectangles, which means the WebView would have to report fence bounding boxes back over postMessage on every scroll, layout change, and fence edit. This is a large, fragile integration for a marginal aesthetic gain — code fences are not architecturally special here, they are just another chunk of rendered text under the ink layer.

User impact: drawing an arrow across a code fence covers part of the code. Accepted. The alternative (ink suddenly vanishing as it crosses the fence edge) would be more jarring than the strikeout.

### 5.4 Title rule (restated as layering)

Title area: **ink-forbidden** (see 2.2 Case 2 and 4.4). Strokes cannot be captured there because the ink layer does not extend there, and the title TextInput has its own hit region that swallows any stylus touch at the OS level. Zero-drop, not silent-drop: the touch never generates a stroke event at all.

### 5.5 Ink above end of document

The ink layer's vertical extent equals the current `contentHeight` measured by `handleLayout` in `CanvasRenderer.tsx`. When the user draws below the end of text (Case 15), the content layer extends, `contentHeight` updates on the next layout pass, and the ink layer's Skia canvas grows to match. The committed stroke's Y coordinate is absolute, so it stays anchored to the correct "paper" location as more text is added above or below later.

---

## 6. Data model

No schema change. Current `CanvasDocument.inkLayer.strokes` is the storage target:

```
inkLayer: {
  strokes: InkStroke[]
}

InkStroke: {
  id: string (nanoid)
  points: StrokePoint[]
  color: string        // hex — default "#DCDDDE" (tokens.textBody)
  width: number        // 3.5 — passed to perfect-freehand as `size`
  opacity: number      // 1.0
}

StrokePoint: {
  x, y, pressure, tilt, timestamp
}
```

`onInkChange` continues to fire on stroke commit (pencil lift), triggering the existing save pipeline via `updateNoteCanvas` in `Editor.tsx`. Save debounce is inherited from the text save pipeline — there is no separate ink debounce, because ink commits are already discrete events (once per pencil lift), unlike per-keystroke text updates.

---

## 7. Out of scope (this slice)

- Eraser
- Pencil color picker UI
- Stroke selection / move / delete
- Undo for individual ink strokes (undo stack for ink)
- Ink sync between devices (Phase 2)
- Desktop / web ink input (tldraw path is separate)
- Lasso selection
- Ink-to-text OCR
- Shape recognition / straightening
- Ink metadata in note list previews

---

## 8. Open questions for Lukas

1. **Title rule — forbidden, safe, or allowed?** I picked **forbidden** (pencil on title does nothing). You could alternatively allow ink in the title strip as a "visual signature" feature, which would be charming but breaks note list previews and makes title-as-filename weird. Confirm forbidden is what you want, or say the word and I'll respec it as allowed.

2. **Default stroke color — `textBody` grey or `accent` tangerine?** I picked **`textBody` (`#DCDDDE`)** because it treats ink as peer-to-text rather than chrome. But if your mental model is "ink is a highlighter-style annotation over my notes," you might want tangerine by default and grey as an option. This is the single most brand-visible decision in the spec — worth a yes/no from you.

3. **COPY button collision (Case 4) — accept the edge case or build the hit-test escape hatch?** The specified escape hatch (short-stroke + in-zone → discard + forward tap) adds ~40 lines of WebView/postMessage glue for an interaction literally no one will do on purpose. I'd prefer to skip it entirely — pencil on COPY just captures a stroke, user rolls eyes, user uses finger next time. Ship the simpler version?
