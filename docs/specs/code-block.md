# Code Block — Unified Component Spec

**Status:** Approved for Phase 1
**Owner:** Designer
**Consumers:** SWE-2 (web / CodeMirror 6 in `packages/editor/src/live-preview/editorHtml.ts`), SWE-1 (native / React Native)
**Aesthetic:** The Digital Monolith — brutalist, 0px radius, tonal stacking, no shadows.

---

## 1. Overview

The fenced code block is a first-class content object in the Graphite canvas. It renders with a two-region anatomy:

```
+---------------------------------------------------+
| [ TYPESCRIPT ]                            COPY    |  <- header (bgSidebar)
+---------------------------------------------------+
|                                                   |
|  const x: number = 42;                            |  <- body (bgDeep)
|  console.log(x);                                  |
|                                                   |
+---------------------------------------------------+
```

Both platforms (web via CodeMirror 6 HTML and native via React Native) must render identically. The visual spec below is the single source of truth; any delta between platforms is a bug.

---

## 2. Tokens used

| Token | Hex | Role in code block |
|---|---|---|
| `bgBase` | `#1E1E1E` | Surrounding canvas (not the block itself) |
| `bgSidebar` | `#252525` | Header bar background |
| `bgDeep` | `#141414` | Body background |
| `bgHover` | `#2C2C2C` | Copy button hover fill |
| `border` | `#333333` | 1px outer border + header/body divider |
| `textPrimary` | `#FFFFFF` | Function names in syntax |
| `textBody` | `#DCDDDE` | Default code text, variable names |
| `textMuted` | `#8A8F98` | COPY button label (idle), operators/punctuation |
| `textHint` | `#555558` | Placeholder text, comments |
| `accent` | `#F28500` | Focus ring, numbers, pressed copy state, regex |
| `accentLight` | `#FFB347` | Language pill text, keywords, types |
| `accentPressed` | `#D4730A` | Copy button pressed fill (momentary) |
| `accentTint` | `#2C1800` | Language pill background |

---

## 3. Header anatomy

The header is a horizontal bar sitting on top of the body, sharing a 1px divider with it.

```
Height:              28px (fixed)
Background:          bgSidebar (#252525)
Border:              1px solid border (#333333) — top, left, right
Border-bottom:       1px solid border (#333333) — acts as header/body seam
Padding:             0 8px (horizontal), 0 vertical (content centered by flex)
Display:             flex row, align-items center, justify-content space-between
```

### 3.1 Language pill (left)

The pill is a compact label identifying the language. **Design choice: `accentTint` background (`#2C1800`) with `accentLight` text (`#FFB347`).**

**Justification:** The inverse-accent option (solid `accentLight` fill with `bgBase` text) screams for attention and competes with the FAB, which owns the loudest accent state in the app. The code block is ambient content — the reader is focused on the code, not the language label. `accentTint` + `accentLight` reads as a quiet burn, matches the "active list item" pattern used elsewhere in the Monolith (burn-tinted recess), and stays out of the way.

```
Display:             inline-flex, align-items center
Height:              18px
Padding:             0 6px
Background:          accentTint (#2C1800)
Border:              none
Border-radius:       0
Font-family:         Inter, system-ui
Font-size:           10px
Font-weight:         600
Letter-spacing:      1.8px
Text-transform:      uppercase
Color:               accentLight (#FFB347)
User-select:         none
```

Content: the normalized language name in uppercase (e.g. `TYPESCRIPT`, `PYTHON`, `RUST`, `JSON`, `BASH`).

### 3.2 Copy button (right)

```
Display:             inline-flex, align-items center
Height:              20px
Padding:             0 8px
Background:          transparent (idle)
Border:              none
Border-radius:       0
Font-family:         Inter, system-ui
Font-size:           10px
Font-weight:         600
Letter-spacing:      1.8px
Text-transform:      uppercase
Color:               textMuted (#8A8F98) (idle)
Cursor:              pointer
```

**States:**

| State | Background | Text color | Label |
|---|---|---|---|
| Idle | transparent | `#8A8F98` | `COPY` |
| Hover | `#2C2C2C` (bgHover) | `#DCDDDE` (textBody) | `COPY` |
| Pressed (momentary, ~120ms) | `#D4730A` (accentPressed) | `#1E1E1E` (bgBase) | `COPY` |
| Confirmed (1.2s after click) | transparent | `#F28500` (accent) | `COPIED` |
| Focused (keyboard) | transparent | `#8A8F98` | `COPY` + 2px outline `#F28500`, 0 offset, 0 radius |

After the 1.2s confirmation window, the button returns to idle with no animation — the label swap is instantaneous in both directions, consistent with the Monolith rule on mechanical interaction.

### 3.3 Header/body seam

There is exactly one 1px line between header and body. Implement as `border-bottom` on the header **or** `border-top` on the body — never both. Recommended: `border-bottom` on the header so the body's own `border` shorthand stays clean.

---

## 4. Body anatomy

```
Background:          bgDeep (#141414)
Border:              1px solid border (#333333) — left, right, bottom only
                     (top is owned by the header's border-bottom)
Border-radius:       0
Padding:             12px 16px
Font-family:         "SF Mono", "Menlo", "Consolas", "Courier New", Courier, monospace
Font-size:           13px
Line-height:         1.55
Color:               textBody (#DCDDDE)
Tab-size:            2
White-space:         pre
Overflow-x:          auto
Overflow-y:          hidden
```

Note on the font stack: Courier is the brand reference in CLAUDE.md, but SF Mono / Menlo / Consolas look materially better on modern displays and are available on all target platforms. Courier is retained as the final fallback to honor the original instruction. Both SWE-1 and SWE-2 must use this exact stack.

### 4.1 Long lines — horizontal scroll

**Confirmed: horizontal scroll, no wrapping.** Developer-tool convention. Wrapping breaks the visual structure of code (indentation, alignment) and introduces a wrap indicator that adds decorative noise — both disqualifiers under the Monolith.

Scrollbar styling (web):
```
Scrollbar track:     transparent
Scrollbar thumb:     #333333 (border token)
Scrollbar thumb hover: #555558 (textHint)
Scrollbar height:    8px
```

Native: the horizontal scroll container must not show a persistent indicator; use the platform default that fades after scroll gesture.

### 4.2 Surrounding spacing

```
Margin-top:          16px
Margin-bottom:       16px
```

Margins collapse with adjacent paragraph margins on the web; native must apply the same 16px gap explicitly above and below.

---

## 5. States

### 5.1 Default

Rendered as specified in sections 3 and 4. Language pill shows the detected language in uppercase. Body shows syntax-highlighted code.

### 5.2 Empty

When a user opens a fence with no content (` ``` ` on its own line or with only a language tag), render a placeholder inside the body:

```
Content:             // write code here
Color:               textHint (#555558)
Font-style:          normal (not italic — italics are reserved for comments in the highlight palette)
```

The body retains full padding; minimum visible body height equals `12px + 13px*1.55 + 12px ≈ 44px`. Do not collapse the block. The placeholder is a visual hint only — it must not appear in the actual markdown source or clipboard copy.

### 5.3 Unknown / missing language

When the info string after the opening fence is empty or the language is not in the CodeMirror language registry, the pill renders **`CODE`**.

Justification for `CODE` over `TXT` / `PLAIN`: `TXT` implies "plain text file" (wrong — it's still a code block); `PLAIN` reads as a content judgment; `CODE` is honest, neutral, and matches the component's identity.

Styling of the pill is unchanged when fallback — same tokens, same dimensions. No italic, no dim treatment. It is not an error state.

### 5.4 Copied confirmation

Triggered by a successful copy-to-clipboard. Button label swaps from `COPY` to `COPIED`, color shifts from `#8A8F98` → `#F28500`. After 1.2s, revert. If the user clicks again during the confirmation window, reset the 1.2s timer and keep the confirmed state — do not flicker.

### 5.5 Keyboard focused

Copy button receives keyboard focus via Tab. Focus ring:
```
Outline:             2px solid #F28500 (accent)
Outline-offset:      0
Border-radius:       0
```

The language pill is not focusable (it's not interactive).

---

## 6. Syntax highlighting review

Reviewed the existing Graphite highlight style in `editorHtml.ts`.

| Token | Color | Weight/Style | Verdict |
|---|---|---|---|
| keyword | `#FFB347` (accentLight) | bold | Approved |
| string | `#A8D060` | normal | Approved — the single non-palette green is intentional and reads as "data" against the orange/grey field. Do not change. |
| comment | `#555558` (textHint) | italic | Approved — italic is correct for comments, and is the *only* place italic is allowed in the component. |
| number / bool / null | `#F28500` (accent) | normal | Approved |
| function | `#FFFFFF` (textPrimary) | normal | Approved — functions are "the things you do," white = highest emphasis. |
| type / className | `#FFB347` (accentLight) | normal | Approved |
| variableName | `#DCDDDE` (textBody) | normal | Approved |
| operator / punctuation | `#8A8F98` (textMuted) | normal | Approved — punctuation correctly recedes. |
| regexp / escape | `#F28500` (accent) | normal | Approved |
| invalid | `#FF6B6B` | underline | **Minor concern.** `#FF6B6B` is a one-off red not in the token system. It's acceptable as a diagnostic-only color (invalid tokens are rare and should stand out), but log it as a candidate for a future `danger` semantic token. Keep as-is for Phase 1. |

**One tweak proposed but deferred:** `keyword` and `type/className` share `#FFB347`, distinguished only by weight. In dense generic-heavy code (TypeScript, Rust) this can blur. Consider splitting `type` to a cooler tone in v1.1 after real-usage feedback. **Do not change in Phase 1.**

**Overall palette: approved as-is for ship.**

---

## 7. Accessibility

- **Copy button:** must have `aria-label="Copy code to clipboard"` in idle/hover/pressed states and `aria-label="Code copied"` during the 1.2s confirmation window. After copy, fire an `aria-live="polite"` announcement of "Copied" for screen readers.
- **Language pill:** wrap in `<span role="img" aria-label="Language: TypeScript">` (substituting the actual language) or use a visually-hidden prefix (`<span class="sr-only">Language: </span>TYPESCRIPT`). Screen readers must not read "TYPESCRIPT" as ambient chrome without context.
- **Focus order:** copy button is focusable (tabindex default). Language pill is not.
- **Focus ring:** 2px solid `#F28500`, 0 offset, 0 radius. Must never be removed by `outline: none` without a replacement.
- **Contrast:** all specified foreground/background pairs meet WCAG AA for 10–13px text: `#FFB347` on `#2C1800` = 8.1:1; `#8A8F98` on `#252525` = 5.2:1; `#DCDDDE` on `#141414` = 13.8:1. Pass.

---

## 8. Pushback on rounded corners

**Overruled.** The user's requirement mentioned rounded corners; the Digital Monolith's 0px radius law is absolute and takes precedence — rounded code blocks would be the loudest exception in the entire UI and would immediately read as foreign against every other surface in the app. 0px is the law. Ship sharp.

---

## 9. Out of scope (Phase 1)

- **Line numbers** — deferred to v1.1.
- **Light mode** — Graphite is dark-only for Phase 1. No light tokens specified.
- **Language switcher UI** — not in scope; language is derived from the fence info string only.
- **Collapse / fold** — not in scope.
- **Inline diff highlighting** — not in scope.
- **Line wrap toggle** — not in scope; horizontal scroll is the only mode.

---

## 10. Exact CSS (ready to paste into `editorHtml.ts`)

```css
/* ----- Code block: outer wrapper (the fenced block as a whole) ----- */
.cm-graphite-codeblock {
  margin: 16px 0;
  background: #141414;
  border: 1px solid #333333;
  border-radius: 0;
  overflow: hidden; /* contains header seam */
}

/* ----- Header bar ----- */
.cm-graphite-codeblock__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  padding: 0 8px;
  background: #252525;
  border-bottom: 1px solid #333333;
  user-select: none;
}

/* ----- Language pill ----- */
.cm-graphite-codeblock__lang {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  background: #2C1800;
  color: #FFB347;
  font-family: Inter, system-ui, -apple-system, sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.8px;
  text-transform: uppercase;
  border: none;
  border-radius: 0;
}

/* ----- Copy button ----- */
.cm-graphite-codeblock__copy {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  background: transparent;
  color: #8A8F98;
  font-family: Inter, system-ui, -apple-system, sans-serif;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.8px;
  text-transform: uppercase;
  border: none;
  border-radius: 0;
  cursor: pointer;
  transition: none;
}
.cm-graphite-codeblock__copy:hover {
  background: #2C2C2C;
  color: #DCDDDE;
}
.cm-graphite-codeblock__copy:active {
  background: #D4730A;
  color: #1E1E1E;
}
.cm-graphite-codeblock__copy:focus-visible {
  outline: 2px solid #F28500;
  outline-offset: 0;
  border-radius: 0;
}
.cm-graphite-codeblock__copy--copied,
.cm-graphite-codeblock__copy--copied:hover {
  background: transparent;
  color: #F28500;
}

/* ----- Body ----- */
.cm-graphite-codeblock__body {
  background: #141414;
  color: #DCDDDE;
  padding: 12px 16px;
  font-family: "SF Mono", Menlo, Consolas, "Courier New", Courier, monospace;
  font-size: 13px;
  line-height: 1.55;
  tab-size: 2;
  white-space: pre;
  overflow-x: auto;
  overflow-y: hidden;
}
.cm-graphite-codeblock__body::-webkit-scrollbar {
  height: 8px;
}
.cm-graphite-codeblock__body::-webkit-scrollbar-track {
  background: transparent;
}
.cm-graphite-codeblock__body::-webkit-scrollbar-thumb {
  background: #333333;
}
.cm-graphite-codeblock__body::-webkit-scrollbar-thumb:hover {
  background: #555558;
}

/* ----- Empty-state placeholder ----- */
.cm-graphite-codeblock__body--empty::before {
  content: "// write code here";
  color: #555558;
}
```

Native (React Native) implementers: translate the above one-for-one. `letter-spacing: 1.8px` → `letterSpacing: 1.8`. No radius, no shadow, no transitions. Use `Pressable` with explicit `pressed` style for the copy button to match the active state exactly.
